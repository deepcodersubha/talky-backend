import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../config/database";
import { AuthenticatedRequest, JWTPayload } from "../types";
import { AppError } from "./error.middleware";

export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError("Authentication required. Missing Bearer token.", 401);
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      throw new AppError("Invalid authorization format.", 401);
    }

    let decoded: JWTPayload;
    try {
      decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JWTPayload;
    } catch {
      throw new AppError("Invalid or expired access token.", 401);
    }

    if (decoded.type !== "access") {
      throw new AppError("Invalid token type provided.", 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, authIdentifier: true, displayName: true },
    });

    if (!user) {
      throw new AppError("User not found or account deactivated.", 401);
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

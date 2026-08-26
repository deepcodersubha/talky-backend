import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthService } from "../services/auth.service";
import { AuthenticatedRequest } from "../types";

export const registerSchema = z.object({
  body: z.object({
    authIdentifier: z.string().min(3, "Identifier must be at least 3 characters").max(100),
    password: z.string().min(6, "Password must be at least 6 characters").optional(),
    displayName: z.string().min(2, "Display name must be at least 2 characters").max(50),
    deviceId: z.string().min(4, "Device ID is required"),
    platform: z.enum(["ANDROID", "IOS", "WEB"]),
    pushToken: z.string().optional(),
    appVersion: z.string().optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    authIdentifier: z.string().min(1, "Identifier is required"),
    password: z.string().optional(),
    deviceId: z.string().min(4, "Device ID is required"),
    platform: z.enum(["ANDROID", "IOS", "WEB"]).optional(),
    pushToken: z.string().optional(),
    appVersion: z.string().optional(),
  }),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(10, "Refresh token is required"),
  }),
});

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.register(req.body);
      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.login(req.body);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tokens = await AuthService.refreshTokens(req.body.refreshToken);
      res.status(200).json({
        success: true,
        data: { tokens },
      });
    } catch (error) {
      next(error);
    }
  }

  static async me(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(200).json({
        success: true,
        data: { user: req.user },
      });
    } catch (error) {
      next(error);
    }
  }
}

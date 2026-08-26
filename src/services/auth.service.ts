import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../config/database";
import { env } from "../config/env";
import { AppError } from "../middlewares/error.middleware";
import { JWTPayload, PlatformType, TokenPair } from "../types";

export class AuthService {
  private static generateTokens(userId: string, authIdentifier: string): TokenPair {
    const accessPayload: JWTPayload = { userId, authIdentifier, type: "access" };
    const refreshPayload: JWTPayload = { userId, authIdentifier, type: "refresh" };

    const accessToken = jwt.sign(accessPayload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRATION as jwt.SignOptions["expiresIn"],
    });

    const refreshToken = jwt.sign(refreshPayload, env.JWT_REFRESH_SECRET, {
      expiresIn: env.JWT_REFRESH_EXPIRATION as jwt.SignOptions["expiresIn"],
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 15 minutes in seconds
    };
  }

  static async register(data: {
    authIdentifier: string;
    password?: string;
    displayName: string;
    deviceId: string;
    platform: PlatformType;
    pushToken?: string;
    appVersion?: string;
  }) {
    const existing = await prisma.user.findUnique({
      where: { authIdentifier: data.authIdentifier.toLowerCase().trim() },
    });

    if (existing) {
      throw new AppError("An account with this identifier already exists.", 409);
    }

    let passwordHash: string | null = null;
    if (data.password) {
      passwordHash = await bcrypt.hash(data.password, 12);
    }

    const user = await prisma.user.create({
      data: {
        authIdentifier: data.authIdentifier.toLowerCase().trim(),
        passwordHash,
        displayName: data.displayName.trim(),
        devices: {
          create: {
            deviceId: data.deviceId,
            platform: data.platform,
            pushToken: data.pushToken,
            appVersion: data.appVersion,
            lastSeenAt: new Date(),
          },
        },
      },
      select: {
        id: true,
        authIdentifier: true,
        displayName: true,
        createdAt: true,
      },
    });

    const tokens = this.generateTokens(user.id, user.authIdentifier);

    return { user, tokens };
  }

  static async login(data: {
    authIdentifier: string;
    password?: string;
    deviceId: string;
    platform?: PlatformType;
    pushToken?: string;
    appVersion?: string;
  }) {
    const user = await prisma.user.findUnique({
      where: { authIdentifier: data.authIdentifier.toLowerCase().trim() },
    });

    if (!user) {
      throw new AppError("Invalid credentials provided.", 401);
    }

    if (user.passwordHash && data.password) {
      const isValid = await bcrypt.compare(data.password, user.passwordHash);
      if (!isValid) {
        throw new AppError("Invalid credentials provided.", 401);
      }
    } else if (user.passwordHash && !data.password) {
      throw new AppError("Password is required for this account.", 401);
    }

    // Upsert or update device session
    if (data.deviceId) {
      await prisma.device.upsert({
        where: { deviceId: data.deviceId },
        create: {
          userId: user.id,
          deviceId: data.deviceId,
          platform: data.platform || "ANDROID",
          pushToken: data.pushToken,
          appVersion: data.appVersion,
          lastSeenAt: new Date(),
        },
        update: {
          userId: user.id,
          platform: data.platform || undefined,
          pushToken: data.pushToken || undefined,
          appVersion: data.appVersion || undefined,
          lastSeenAt: new Date(),
          isActive: true,
        },
      });
    }

    const tokens = this.generateTokens(user.id, user.authIdentifier);

    return {
      user: {
        id: user.id,
        authIdentifier: user.authIdentifier,
        displayName: user.displayName,
        createdAt: user.createdAt,
      },
      tokens,
    };
  }

  static async refreshTokens(refreshToken: string): Promise<TokenPair> {
    let decoded: JWTPayload;
    try {
      decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as JWTPayload;
    } catch {
      throw new AppError("Invalid or expired refresh token.", 401);
    }

    if (decoded.type !== "refresh") {
      throw new AppError("Invalid token type.", 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, authIdentifier: true },
    });

    if (!user) {
      throw new AppError("User account not found.", 401);
    }

    return this.generateTokens(user.id, user.authIdentifier);
  }

  static async registerDevice(
    userId: string,
    data: {
      deviceId: string;
      platform: PlatformType;
      pushToken?: string;
      appVersion?: string;
    }
  ) {
    return prisma.device.upsert({
      where: { deviceId: data.deviceId },
      create: {
        userId,
        deviceId: data.deviceId,
        platform: data.platform,
        pushToken: data.pushToken,
        appVersion: data.appVersion,
        lastSeenAt: new Date(),
      },
      update: {
        userId,
        platform: data.platform,
        pushToken: data.pushToken,
        appVersion: data.appVersion,
        lastSeenAt: new Date(),
        isActive: true,
      },
    });
  }
}

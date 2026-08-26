import { Response, NextFunction } from "express";
import { z } from "zod";
import { AuthService } from "../services/auth.service";
import { AuthenticatedRequest } from "../types";

export const registerDeviceSchema = z.object({
  body: z.object({
    deviceId: z.string().min(4, "Device ID is required"),
    platform: z.enum(["ANDROID", "IOS", "WEB"]),
    pushToken: z.string().optional(),
    appVersion: z.string().optional(),
  }),
});

export class DeviceController {
  static async register(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const device = await AuthService.registerDevice(userId, req.body);
      res.status(200).json({
        success: true,
        data: { device },
      });
    } catch (error) {
      next(error);
    }
  }
}

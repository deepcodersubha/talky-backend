import { Response, NextFunction } from "express";
import { z } from "zod";
import { PairingService } from "../services/pairing.service";
import { AuthenticatedRequest } from "../types";

export const joinPairingSchema = z.object({
  body: z.object({
    code: z
      .string()
      .min(4, "Pairing code must be at least 4 characters")
      .max(10, "Pairing code must be at most 10 characters")
      .transform((val) => val.trim().toUpperCase()),
  }),
});

export const unpairSchema = z.object({
  body: z.object({
    pairingId: z.string().uuid("Invalid pairing ID format"),
  }),
});

export const silenceSchema = z.object({
  params: z.object({
    id: z.string().uuid("Invalid pairing ID format"),
  }),
  body: z.object({
    silenced: z.boolean(),
    durationMinutes: z.number().int().positive().optional(),
  }),
});

export const pairingStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid("Invalid pairing ID format"),
  }),
});

export class PairingController {
  static async generateCode(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user!.id;
      const result = await PairingService.generatePairingCode(userId);
      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async join(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const result = await PairingService.joinPairing(userId, req.body.code);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getCurrent(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user!.id;
      const result = await PairingService.getCurrentPairing(userId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async unpair(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const result = await PairingService.unpair(userId, req.body.pairingId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getStatus(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user!.id;
      const pairingId = req.params.id as string;
      const result = await PairingService.getPairingStatus(userId, pairingId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async toggleSilence(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user!.id;
      const pairingId = req.params.id as string;
      const { silenced, durationMinutes } = req.body;
      const result = await PairingService.toggleSilence(userId, pairingId, silenced, durationMinutes);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

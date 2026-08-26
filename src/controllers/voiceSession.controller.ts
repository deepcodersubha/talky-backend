import { Response, NextFunction } from "express";
import { z } from "zod";
import { VoiceSessionService } from "../services/voiceSession.service";
import { AuthenticatedRequest } from "../types";

export const startSessionSchema = z.object({
  body: z.object({
    pairingId: z.string().uuid("Invalid pairing ID format"),
  }),
});

export const stopSessionSchema = z.object({
  params: z.object({
    id: z.string().uuid("Invalid session ID format"),
  }),
});

export class VoiceSessionController {
  static async start(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user!.id;
      const result = await VoiceSessionService.startSession(userId, req.body.pairingId);
      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async stop(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user!.id;
      const sessionId = req.params.id as string;
      const result = await VoiceSessionService.stopSession(userId, sessionId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async cancel(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user!.id;
      const sessionId = req.params.id as string;
      const result = await VoiceSessionService.cancelSession(userId, sessionId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

import { Response, NextFunction } from "express";
import { AgoraService } from "../services/agora.service";
import { AuthenticatedRequest } from "../types";

export class AgoraController {
  static async getToken(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user!.id;
      const pairingId = req.params.id as string;
      const result = await AgoraService.generateTokenForPairing(userId, pairingId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

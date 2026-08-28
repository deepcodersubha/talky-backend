import { Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { VoiceNoteService } from "../services/voiceNote.service";
import { AppError } from "../middlewares/error.middleware";
import { AuthenticatedRequest } from "../types";

const uploadDir = path.join(process.cwd(), "public/uploads/voice-notes");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".m4a";
    cb(null, `vn_${Date.now()}_${randomUUID().substring(0, 8)}${ext}`);
  },
});

export const uploadVoiceNoteMiddleware = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
}).single("audio");

export class VoiceNoteController {
  static async upload(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    if (!req.file) {
      throw new AppError("Audio file is required.", 400);
    }

    const { pairingId, durationMs } = req.body;
    if (!pairingId) {
      throw new AppError("pairingId is required.", 400);
    }

    const audioUrl = `/uploads/voice-notes/${req.file.filename}`;
    const voiceNote = await VoiceNoteService.createVoiceNote(
      userId,
      pairingId,
      audioUrl,
      parseInt(durationMs || "0", 10)
    );

    res.status(201).json({
      success: true,
      data: { voiceNote },
    });
  }

  static async getPending(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    const voiceNotes = await VoiceNoteService.getPendingVoiceNotes(userId);

    res.status(200).json({
      success: true,
      data: { voiceNotes },
    });
  }

  static async markPlayed(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    const id = req.params.id as string;
    const voiceNote = await VoiceNoteService.markAsPlayed(userId, id);

    res.status(200).json({
      success: true,
      data: { voiceNote },
    });
  }
}

import { prisma } from "../config/database";
import { AppError } from "../middlewares/error.middleware";
import { PushService } from "./push.service";
import { SessionManager } from "../websocket/sessionManager";

export class VoiceNoteService {
  /**
   * Saves an uploaded voice note and notifies the paired partner.
   */
  static async createVoiceNote(
    userId: string,
    pairingId: string,
    audioUrl: string,
    durationMs: number
  ) {
    const pairing = await prisma.pairing.findUnique({
      where: { id: pairingId },
      include: {
        userOne: { select: { id: true, displayName: true } },
        userTwo: { select: { id: true, displayName: true } },
      },
    });

    if (!pairing) {
      throw new AppError("Pairing not found.", 404);
    }

    if (pairing.userOneId !== userId && pairing.userTwoId !== userId) {
      throw new AppError("Not authorized to send voice note in this pairing.", 403);
    }

    const recipient = pairing.userOneId === userId ? pairing.userTwo : pairing.userOne;
    const sender = pairing.userOneId === userId ? pairing.userOne : pairing.userTwo;

    const voiceNote = await (prisma as any).voiceNote.create({
      data: {
        pairingId: pairing.id,
        senderUserId: userId,
        audioUrl,
        durationMs: durationMs || 0,
        isDelivered: false,
      },
    });

    // 1. Send WebSocket event to recipient if connected
    try {
      SessionManager.sendToUser(recipient.id, "voice_note_received", {
        id: voiceNote.id,
        pairingId: pairing.id,
        audioUrl: voiceNote.audioUrl,
        durationMs: voiceNote.durationMs,
        senderDisplayName: sender.displayName,
        createdAt: voiceNote.createdAt,
      });
    } catch {
      // WS send non-fatal
    }

    // 2. Dispatch FCM high-priority alert to recipient
    try {
      await PushService.sendPTTAlert(recipient.id, {
        pairingId: pairing.id,
        sessionId: voiceNote.id,
        speakerUserId: userId,
        speakerDisplayName: sender.displayName,
        agoraChannelName: pairing.agoraChannelName,
      });
    } catch {
      // FCM push non-fatal
    }

    return voiceNote;
  }

  /**
   * Retrieves all pending/unplayed voice notes for the authenticated user.
   */
  static async getPendingVoiceNotes(userId: string) {
    // Find all pairings where user participates
    const activePairings = await prisma.pairing.findMany({
      where: {
        OR: [{ userOneId: userId }, { userTwoId: userId }],
        status: "ACTIVE",
      },
      select: { id: true },
    });

    const pairingIds = activePairings.map((p) => p.id);

    if (pairingIds.length === 0) {
      return [];
    }

    // Fetch voice notes sent to this user (not created by this user) that are not played
    const voiceNotes = await (prisma as any).voiceNote.findMany({
      where: {
        pairingId: { in: pairingIds },
        senderUserId: { not: userId },
        playedAt: null,
      },
      include: {
        senderUser: {
          select: { id: true, displayName: true, authIdentifier: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return voiceNotes;
  }

  /**
   * Marks a voice note as played/delivered.
   */
  static async markAsPlayed(userId: string, voiceNoteId: string) {
    const voiceNote = await (prisma as any).voiceNote.findUnique({
      where: { id: voiceNoteId },
      include: {
        pairing: true,
      },
    });

    if (!voiceNote) {
      throw new AppError("Voice note not found.", 404);
    }

    if (voiceNote.pairing.userOneId !== userId && voiceNote.pairing.userTwoId !== userId) {
      throw new AppError("Unauthorized.", 403);
    }

    const updated = await (prisma as any).voiceNote.update({
      where: { id: voiceNoteId },
      data: {
        isDelivered: true,
        playedAt: new Date(),
      },
    });

    return updated;
  }
}

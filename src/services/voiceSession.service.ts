import { prisma } from "../config/database";
import { AppError } from "../middlewares/error.middleware";

export class VoiceSessionService {
  /**
   * Starts a new live voice transmission session.
   */
  static async startSession(userId: string, pairingId: string) {
    const pairing = await prisma.pairing.findUnique({
      where: { id: pairingId },
      select: {
        id: true,
        userOneId: true,
        userTwoId: true,
        status: true,
        agoraChannelName: true,
      },
    });

    if (!pairing) {
      throw new AppError("Pairing not found.", 404);
    }

    if (pairing.userOneId !== userId && pairing.userTwoId !== userId) {
      throw new AppError("Not authorized to start a voice session in this pairing.", 403);
    }

    if (pairing.status !== "ACTIVE") {
      throw new AppError("Cannot start session in an inactive pairing.", 400);
    }

    const session = await prisma.voiceSession.create({
      data: {
        pairingId: pairing.id,
        senderUserId: userId,
        status: "ACTIVE",
        startedAt: new Date(),
      },
    });

    return {
      session: {
        id: session.id,
        pairingId: session.pairingId,
        senderUserId: session.senderUserId,
        status: session.status,
        startedAt: session.startedAt,
        agoraChannelName: pairing.agoraChannelName,
      },
    };
  }

  /**
   * Completes a voice transmission session upon releasing PTT button.
   */
  static async stopSession(userId: string, sessionId: string) {
    const session = await prisma.voiceSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new AppError("Voice session not found.", 404);
    }

    if (session.senderUserId !== userId) {
      throw new AppError("You are not the originator of this voice session.", 403);
    }

    if (session.status === "COMPLETED" || session.status === "CANCELED") {
      return {
        session,
        durationMs: session.endedAt
          ? Math.max(0, session.endedAt.getTime() - session.startedAt.getTime())
          : 0,
      };
    }

    const endedAt = new Date();
    const durationMs = Math.max(0, endedAt.getTime() - session.startedAt.getTime());

    const updated = await prisma.voiceSession.update({
      where: { id: sessionId },
      data: {
        status: "COMPLETED",
        endedAt,
      },
    });

    return {
      session: updated,
      durationMs,
    };
  }

  /**
   * Cancels a discarded voice transmission.
   */
  static async cancelSession(userId: string, sessionId: string) {
    const session = await prisma.voiceSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.senderUserId !== userId) {
      throw new AppError("Voice session not found or unauthorized.", 403);
    }

    const updated = await prisma.voiceSession.update({
      where: { id: sessionId },
      data: {
        status: "CANCELED",
        endedAt: new Date(),
      },
    });

    return { session: updated };
  }
}

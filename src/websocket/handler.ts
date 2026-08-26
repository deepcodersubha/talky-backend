import { WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { prisma } from "../config/database";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { JWTPayload } from "../types";
import { SessionManager } from "./sessionManager";
import { PushService } from "../services/push.service";
import {
  AuthPayload,
  HeartbeatPayload,
  PTTStartedPayload,
  PTTStoppedPayload,
  SilenceChangedPayload,
  SubscribePairingPayload,
  WSIncomingMessage,
} from "./types";

export class WSHandler {
  static async handleMessage(socket: WebSocket, rawData: string): Promise<void> {
    try {
      const message: WSIncomingMessage = JSON.parse(rawData);
      if (!message.event) {
        SessionManager.sendToSocket(socket, "error", {
          code: "INVALID_MESSAGE",
          message: "Missing event property",
        });
        return;
      }

      switch (message.event) {
        case "authenticate":
          await this.handleAuthenticate(socket, message.payload as AuthPayload);
          break;

        case "subscribe_pairing":
          await this.handleSubscribePairing(socket, message.payload as SubscribePairingPayload);
          break;

        case "ptt_started":
          await this.handlePTTStarted(socket, message.payload as PTTStartedPayload);
          break;

        case "ptt_stopped":
          await this.handlePTTStopped(socket, message.payload as PTTStoppedPayload);
          break;

        case "silence_changed":
          await this.handleSilenceChanged(socket, message.payload as SilenceChangedPayload);
          break;

        case "heartbeat":
          this.handleHeartbeat(socket, message.payload as HeartbeatPayload);
          break;

        default:
          SessionManager.sendToSocket(socket, "error", {
            code: "UNKNOWN_EVENT",
            message: `Unknown WebSocket event: ${message.event}`,
          });
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Malformed WebSocket payload";
      logger.warn(`WebSocket message parsing error: ${errorMsg}`);
      SessionManager.sendToSocket(socket, "error", {
        code: "BAD_REQUEST",
        message: errorMsg,
      });
    }
  }

  private static async handleAuthenticate(socket: WebSocket, payload?: AuthPayload): Promise<void> {
    if (!payload?.token) {
      SessionManager.sendToSocket(socket, "error", {
        code: "UNAUTHORIZED",
        message: "Missing authentication token",
      });
      return;
    }

    try {
      const decoded = jwt.verify(payload.token, env.JWT_ACCESS_SECRET) as JWTPayload;
      if (decoded.type !== "access") {
        SessionManager.sendToSocket(socket, "error", {
          code: "INVALID_TOKEN",
          message: "Provided token is not an access token",
        });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, displayName: true, authIdentifier: true },
      });

      if (!user) {
        SessionManager.sendToSocket(socket, "error", {
          code: "USER_NOT_FOUND",
          message: "User account no longer exists",
        });
        return;
      }

      const wasOnline = SessionManager.isUserOnline(user.id);
      SessionManager.registerUserSocket(user.id, socket, user);

      // Find user's active pairing if one exists
      const activePairing = await prisma.pairing.findFirst({
        where: {
          OR: [{ userOneId: user.id }, { userTwoId: user.id }],
          status: "ACTIVE",
        },
        select: { id: true },
      });

      if (activePairing) {
        SessionManager.setMeta(socket, { activePairingId: activePairing.id });
        SessionManager.subscribePairing(user.id, activePairing.id);
      }

      SessionManager.sendToSocket(socket, "authenticated", {
        userId: user.id,
        activePairingId: activePairing?.id || null,
      });

      // Broadcast online presence if transition from offline to online
      if (!wasOnline) {
        await SessionManager.notifyPresenceChange(user.id, true);
      }
    } catch {
      SessionManager.sendToSocket(socket, "error", {
        code: "AUTH_FAILED",
        message: "Invalid or expired JWT token",
      });
    }
  }

  private static async handleSubscribePairing(
    socket: WebSocket,
    payload?: SubscribePairingPayload
  ): Promise<void> {
    const meta = SessionManager.getMeta(socket);
    if (!meta.userId) {
      SessionManager.sendToSocket(socket, "error", {
        code: "UNAUTHORIZED",
        message: "Authenticate before subscribing to pairing events",
      });
      return;
    }

    if (!payload?.pairingId) {
      SessionManager.sendToSocket(socket, "error", {
        code: "BAD_REQUEST",
        message: "Missing pairingId parameter",
      });
      return;
    }

    const pairing = await prisma.pairing.findUnique({
      where: { id: payload.pairingId },
      select: { id: true, userOneId: true, userTwoId: true, status: true, agoraChannelName: true },
    });

    if (
      !pairing ||
      (pairing.userOneId !== meta.userId && pairing.userTwoId !== meta.userId) ||
      pairing.status !== "ACTIVE"
    ) {
      SessionManager.sendToSocket(socket, "error", {
        code: "FORBIDDEN",
        message: "Not authorized to subscribe to this pairing",
      });
      return;
    }

    SessionManager.setMeta(socket, { activePairingId: pairing.id });
    SessionManager.subscribePairing(meta.userId, pairing.id);

    // Send peer's current presence to subscriber
    const peerUserId = pairing.userOneId === meta.userId ? pairing.userTwoId : pairing.userOneId;
    const isPeerOnline = SessionManager.isUserOnline(peerUserId);

    SessionManager.sendToSocket(socket, "peer_presence_changed", {
      peerUserId,
      isOnline: isPeerOnline,
      lastSeenAt: new Date().toISOString(),
    });
  }

  private static async handlePTTStarted(
    socket: WebSocket,
    payload?: PTTStartedPayload
  ): Promise<void> {
    const meta = SessionManager.getMeta(socket);
    if (!meta.userId) {
      SessionManager.sendToSocket(socket, "error", {
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
      return;
    }

    if (!payload?.pairingId) {
      SessionManager.sendToSocket(socket, "error", {
        code: "BAD_REQUEST",
        message: "Missing pairingId",
      });
      return;
    }

    const pairing = await prisma.pairing.findUnique({
      where: { id: payload.pairingId },
      select: {
        id: true,
        userOneId: true,
        userTwoId: true,
        status: true,
        agoraChannelName: true,
      },
    });

    if (
      !pairing ||
      (pairing.userOneId !== meta.userId && pairing.userTwoId !== meta.userId) ||
      pairing.status !== "ACTIVE"
    ) {
      SessionManager.sendToSocket(socket, "error", {
        code: "FORBIDDEN",
        message: "Pairing is not active or unauthorized",
      });
      return;
    }

    // Create active voice session in DB
    const voiceSession = await prisma.voiceSession.create({
      data: {
        pairingId: pairing.id,
        senderUserId: meta.userId,
        status: "ACTIVE",
        startedAt: new Date(),
      },
    });

    const now = Date.now();
    const peerUserId = pairing.userOneId === meta.userId ? pairing.userTwoId : pairing.userOneId;

    // 1. Broadcast speaker_started to the remote peer via active WebSocket
    await SessionManager.broadcastToPairing(
      pairing.id,
      meta.userId,
      "speaker_started",
      {
        sessionId: voiceSession.id,
        pairingId: pairing.id,
        speakerUserId: meta.userId,
        speakerDisplayName: meta.displayName || "Paired Device",
        agoraChannelName: pairing.agoraChannelName,
        timestamp: now,
      },
      false // Do not send back to sender
    );

    // 2. Dispatch FCM High-Priority Data / APNs PTT push to wake background/suspended device
    PushService.sendPTTAlert(peerUserId, {
      pairingId: pairing.id,
      sessionId: voiceSession.id,
      speakerUserId: meta.userId,
      speakerDisplayName: meta.displayName || "Paired Device",
      agoraChannelName: pairing.agoraChannelName,
    }).catch(() => {});
  }

  private static async handlePTTStopped(
    socket: WebSocket,
    payload?: PTTStoppedPayload
  ): Promise<void> {
    const meta = SessionManager.getMeta(socket);
    if (!meta.userId) {
      SessionManager.sendToSocket(socket, "error", {
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
      return;
    }

    if (!payload?.pairingId || !payload?.sessionId) {
      SessionManager.sendToSocket(socket, "error", {
        code: "BAD_REQUEST",
        message: "Missing pairingId or sessionId",
      });
      return;
    }

    const session = await prisma.voiceSession.findUnique({
      where: { id: payload.sessionId },
      select: { id: true, senderUserId: true, startedAt: true, status: true },
    });

    if (!session || session.senderUserId !== meta.userId) {
      SessionManager.sendToSocket(socket, "error", {
        code: "NOT_FOUND",
        message: "Voice session not found or not owned by caller",
      });
      return;
    }

    const endedAt = new Date();
    const durationMs = Math.max(0, endedAt.getTime() - new Date(session.startedAt).getTime());

    await prisma.voiceSession.update({
      where: { id: session.id },
      data: {
        status: "COMPLETED",
        endedAt,
      },
    });

    // Broadcast speaker_stopped to the remote peer
    await SessionManager.broadcastToPairing(
      payload.pairingId,
      meta.userId,
      "speaker_stopped",
      {
        sessionId: session.id,
        pairingId: payload.pairingId,
        speakerUserId: meta.userId,
        durationMs,
        timestamp: Date.now(),
      },
      false
    );
  }

  private static async handleSilenceChanged(
    socket: WebSocket,
    payload?: SilenceChangedPayload
  ): Promise<void> {
    const meta = SessionManager.getMeta(socket);
    if (!meta.userId || !payload?.pairingId) return;

    await prisma.userSetting.upsert({
      where: {
        userId_pairingId: { userId: meta.userId, pairingId: payload.pairingId },
      },
      create: {
        userId: meta.userId,
        pairingId: payload.pairingId,
        silenced: payload.silenced,
      },
      update: {
        silenced: payload.silenced,
      },
    });

    SessionManager.sendToSocket(socket, "silence_updated", {
      pairingId: payload.pairingId,
      userId: meta.userId,
      silenced: payload.silenced,
    });
  }

  private static handleHeartbeat(socket: WebSocket, payload?: HeartbeatPayload): void {
    const meta = SessionManager.getMeta(socket);
    meta.isAlive = true;
    SessionManager.sendToSocket(socket, "heartbeat_ack", {
      timestamp: Date.now(),
      clientTimestamp: payload?.timestamp || null,
    });
  }
}

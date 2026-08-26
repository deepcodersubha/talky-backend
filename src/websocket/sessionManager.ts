import { WebSocket } from "ws";
import { prisma } from "../config/database";
import { logger } from "../config/logger";
import { WSServerEvent, WSOutgoingMessage } from "./types";

export interface SocketMetadata {
  userId?: string;
  displayName?: string;
  authIdentifier?: string;
  activePairingId?: string;
  isAlive: boolean;
}

export class SessionManager {
  // Map of userId -> Set of active WebSocket connections
  private static userSockets = new Map<string, Set<WebSocket>>();

  // Map of pairingId -> Set of userIds subscribed to this pairing
  private static pairingSubscribers = new Map<string, Set<string>>();

  // WeakMap linking WebSocket instances to their session metadata
  private static socketMeta = new WeakMap<WebSocket, SocketMetadata>();

  static setMeta(socket: WebSocket, meta: Partial<SocketMetadata>): void {
    const current = this.socketMeta.get(socket) || { isAlive: true };
    this.socketMeta.set(socket, { ...current, ...meta });
  }

  static getMeta(socket: WebSocket): SocketMetadata {
    return this.socketMeta.get(socket) || { isAlive: false };
  }

  static registerUserSocket(
    userId: string,
    socket: WebSocket,
    meta: { displayName: string; authIdentifier: string }
  ): void {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socket);

    this.setMeta(socket, {
      userId,
      displayName: meta.displayName,
      authIdentifier: meta.authIdentifier,
      isAlive: true,
    });

    logger.debug(`User ${userId} registered WebSocket connection.`);
  }

  static removeSocket(socket: WebSocket): { userId?: string; pairingId?: string } {
    const meta = this.getMeta(socket);
    const userId = meta.userId;
    const pairingId = meta.activePairingId;

    if (userId && this.userSockets.has(userId)) {
      const set = this.userSockets.get(userId)!;
      set.delete(socket);
      if (set.size === 0) {
        this.userSockets.delete(userId);
      }
    }

    if (pairingId && userId && this.pairingSubscribers.has(pairingId)) {
      if (!this.isUserOnline(userId)) {
        this.pairingSubscribers.get(pairingId)?.delete(userId);
      }
    }

    return { userId, pairingId };
  }

  static isUserOnline(userId: string): boolean {
    const sockets = this.userSockets.get(userId);
    return !!sockets && sockets.size > 0;
  }

  static subscribePairing(userId: string, pairingId: string): void {
    if (!this.pairingSubscribers.has(pairingId)) {
      this.pairingSubscribers.set(pairingId, new Set());
    }
    this.pairingSubscribers.get(pairingId)!.add(userId);
  }

  static sendToSocket<T>(socket: WebSocket, event: WSServerEvent, payload: T): void {
    if (socket.readyState === WebSocket.OPEN) {
      const message: WSOutgoingMessage<T> = {
        event,
        payload,
        timestamp: Date.now(),
      };
      socket.send(JSON.stringify(message));
    }
  }

  static sendToUser<T>(userId: string, event: WSServerEvent, payload: T): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;

    for (const socket of sockets) {
      this.sendToSocket(socket, event, payload);
    }
  }

  static async broadcastToPairing<T>(
    pairingId: string,
    senderUserId: string | null,
    event: WSServerEvent,
    payload: T,
    includeSender = false
  ): Promise<void> {
    // Look up pairing to get the two participants
    const pairing = await prisma.pairing.findUnique({
      where: { id: pairingId },
      select: { userOneId: true, userTwoId: true, status: true },
    });

    if (!pairing || pairing.status !== "ACTIVE") return;

    const participants = [pairing.userOneId, pairing.userTwoId];

    for (const participantId of participants) {
      if (!includeSender && participantId === senderUserId) {
        continue;
      }
      this.sendToUser(participantId, event, payload);
    }
  }

  static async notifyPresenceChange(userId: string, isOnline: boolean): Promise<void> {
    // Find all active pairings for this user
    const pairings = await prisma.pairing.findMany({
      where: {
        OR: [{ userOneId: userId }, { userTwoId: userId }],
        status: "ACTIVE",
      },
      select: { id: true, userOneId: true, userTwoId: true },
    });

    const now = new Date().toISOString();

    for (const pairing of pairings) {
      const peerUserId = pairing.userOneId === userId ? pairing.userTwoId : pairing.userOneId;

      this.sendToUser(peerUserId, "peer_presence_changed", {
        peerUserId: userId,
        isOnline,
        lastSeenAt: now,
      });
    }

    // Update lastSeenAt on devices in DB
    try {
      await prisma.device.updateMany({
        where: { userId, isActive: true },
        data: { lastSeenAt: new Date() },
      });
    } catch (err) {
      logger.warn(`Failed to update lastSeenAt for user ${userId}:`, err);
    }
  }
}

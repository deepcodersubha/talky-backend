import http from "http";
import WebSocket from "ws";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/database";
import { initWebSocketServer } from "../src/websocket/server";
import { WSOutgoingMessage } from "../src/websocket/types";

describe("Phase 4: WebSocket Authentication, Presence & Live Signaling", () => {
  let server: http.Server;
  let port: number;
  let userAToken: string;
  let userBToken: string;
  let userAId: string;
  let userBId: string;
  let pairingId: string;

  beforeAll(async () => {
    // Clear test database
    await prisma.userSetting.deleteMany();
    await prisma.voiceSession.deleteMany();
    await prisma.pairing.deleteMany();
    await prisma.pairingCode.deleteMany();
    await prisma.device.deleteMany();
    await prisma.user.deleteMany();

    const app = createApp();
    server = http.createServer(app);
    initWebSocketServer(server);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (typeof addr === "object" && addr !== null) {
          port = addr.port;
        }
        resolve();
      });
    });

    // Register User A
    const resA = await request(app).post("/api/v1/auth/register").send({
      authIdentifier: "ws_userA@talky.app",
      password: "Password123!",
      displayName: "WS Alice",
      deviceId: "device-ws-A",
      platform: "ANDROID",
    });
    userAToken = resA.body.data.tokens.accessToken;
    userAId = resA.body.data.user.id;

    // Register User B
    const resB = await request(app).post("/api/v1/auth/register").send({
      authIdentifier: "ws_userB@talky.app",
      password: "Password123!",
      displayName: "WS Bob",
      deviceId: "device-ws-B",
      platform: "IOS",
    });
    userBToken = resB.body.data.tokens.accessToken;
    userBId = resB.body.data.user.id;

    // Create pairing between User A and User B
    const codeRes = await request(app)
      .post("/api/v1/pairings/code")
      .set("Authorization", `Bearer ${userAToken}`);
    const code = codeRes.body.data.code;

    const joinRes = await request(app)
      .post("/api/v1/pairings/join")
      .set("Authorization", `Bearer ${userBToken}`)
      .send({ code });
    pairingId = joinRes.body.data.pairing.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  const createWSClient = (): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });
  };

  const waitForEvent = <T>(ws: WebSocket, targetEvent: string, timeout = 3000): Promise<T> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for event "${targetEvent}"`));
      }, timeout);

      const handler = (data: WebSocket.RawData) => {
        try {
          const parsed: WSOutgoingMessage<T> = JSON.parse(data.toString());
          if (parsed.event === targetEvent) {
            clearTimeout(timer);
            ws.off("message", handler);
            resolve(parsed.payload);
          }
        } catch {
          // ignore malformed test payloads
        }
      };

      ws.on("message", handler);
    });
  };

  it("should authenticate WebSocket connection and return user ID and active pairing ID", async () => {
    const ws = await createWSClient();

    const authPromise = waitForEvent<{ userId: string; activePairingId: string }>(
      ws,
      "authenticated"
    );

    ws.send(
      JSON.stringify({
        event: "authenticate",
        payload: { token: userAToken },
      })
    );

    const result = await authPromise;
    expect(result.userId).toBe(userAId);
    expect(result.activePairingId).toBe(pairingId);

    ws.close();
  });

  it("should reject invalid token with AUTH_FAILED error", async () => {
    const ws = await createWSClient();

    const errorPromise = waitForEvent<{ code: string }>(ws, "error");

    ws.send(
      JSON.stringify({
        event: "authenticate",
        payload: { token: "invalid_expired_token_123" },
      })
    );

    const result = await errorPromise;
    expect(result.code).toBe("AUTH_FAILED");

    ws.close();
  });

  it("should broadcast real-time presence changes between paired users", async () => {
    const wsB = await createWSClient();
    wsB.send(JSON.stringify({ event: "authenticate", payload: { token: userBToken } }));
    await waitForEvent(wsB, "authenticated");

    // Set up listener on User B for User A coming online
    const presenceOnlinePromise = waitForEvent<{ peerUserId: string; isOnline: boolean }>(
      wsB,
      "peer_presence_changed"
    );

    const wsA = await createWSClient();
    wsA.send(JSON.stringify({ event: "authenticate", payload: { token: userAToken } }));
    await waitForEvent(wsA, "authenticated");

    const onlinePayload = await presenceOnlinePromise;
    expect(onlinePayload.peerUserId).toBe(userAId);
    expect(onlinePayload.isOnline).toBe(true);

    // Set up listener on User B for User A going offline
    const presenceOfflinePromise = waitForEvent<{ peerUserId: string; isOnline: boolean }>(
      wsB,
      "peer_presence_changed"
    );

    wsA.close();

    const offlinePayload = await presenceOfflinePromise;
    expect(offlinePayload.peerUserId).toBe(userAId);
    expect(offlinePayload.isOnline).toBe(false);

    wsB.close();
  });

  it("should handle ptt_started and broadcast speaker_started to peer with voice session ID", async () => {
    const wsA = await createWSClient();
    const wsB = await createWSClient();

    wsA.send(JSON.stringify({ event: "authenticate", payload: { token: userAToken } }));
    wsB.send(JSON.stringify({ event: "authenticate", payload: { token: userBToken } }));
    await Promise.all([waitForEvent(wsA, "authenticated"), waitForEvent(wsB, "authenticated")]);

    const speakerStartedPromise = waitForEvent<{
      sessionId: string;
      pairingId: string;
      speakerUserId: string;
      speakerDisplayName: string;
      agoraChannelName: string;
    }>(wsB, "speaker_started");

    // User A presses PTT button
    wsA.send(
      JSON.stringify({
        event: "ptt_started",
        payload: { pairingId },
      })
    );

    const startedPayload = await speakerStartedPromise;
    expect(startedPayload.pairingId).toBe(pairingId);
    expect(startedPayload.speakerUserId).toBe(userAId);
    expect(startedPayload.speakerDisplayName).toBe("WS Alice");
    expect(startedPayload.agoraChannelName).toMatch(/^talky_pair_/);
    expect(startedPayload.sessionId).toBeDefined();

    // Verify session in database is ACTIVE
    const dbSession = await prisma.voiceSession.findUnique({
      where: { id: startedPayload.sessionId },
    });
    expect(dbSession).toBeDefined();
    expect(dbSession?.status).toBe("ACTIVE");

    // User A releases PTT button
    const speakerStoppedPromise = waitForEvent<{
      sessionId: string;
      speakerUserId: string;
      durationMs: number;
    }>(wsB, "speaker_stopped");

    wsA.send(
      JSON.stringify({
        event: "ptt_stopped",
        payload: { pairingId, sessionId: startedPayload.sessionId },
      })
    );

    const stoppedPayload = await speakerStoppedPromise;
    expect(stoppedPayload.sessionId).toBe(startedPayload.sessionId);
    expect(stoppedPayload.speakerUserId).toBe(userAId);
    expect(stoppedPayload.durationMs).toBeGreaterThanOrEqual(0);

    // Verify session in database is now COMPLETED
    const dbSessionEnded = await prisma.voiceSession.findUnique({
      where: { id: startedPayload.sessionId },
    });
    expect(dbSessionEnded?.status).toBe("COMPLETED");
    expect(dbSessionEnded?.endedAt).not.toBeNull();

    wsA.close();
    wsB.close();
  });

  it("should respond immediately to heartbeat pings with heartbeat_ack", async () => {
    const ws = await createWSClient();
    ws.send(JSON.stringify({ event: "authenticate", payload: { token: userAToken } }));
    await waitForEvent(ws, "authenticated");

    const ackPromise = waitForEvent<{ timestamp: number; clientTimestamp: number }>(
      ws,
      "heartbeat_ack"
    );

    const clientTs = Date.now();
    ws.send(
      JSON.stringify({
        event: "heartbeat",
        payload: { timestamp: clientTs },
      })
    );

    const ack = await ackPromise;
    expect(ack.timestamp).toBeDefined();
    expect(ack.clientTimestamp).toBe(clientTs);

    ws.close();
  });
});

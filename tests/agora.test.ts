import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/database";

const app = createApp();

describe("Phase 5: Agora RTC Token Generation & Voice Session Management", () => {
  let userAToken: string;
  let userBToken: string;
  let userCToken: string;
  let userAId: string;
  let userBId: string;
  let userCId: string;
  let activePairingId: string;
  let agoraChannelName: string;

  beforeAll(async () => {
    // Clear test database
    await prisma.userSetting.deleteMany();
    await prisma.voiceSession.deleteMany();
    await prisma.pairing.deleteMany();
    await prisma.pairingCode.deleteMany();
    await prisma.device.deleteMany();
    await prisma.user.deleteMany();

    // Register User A
    const resA = await request(app).post("/api/v1/auth/register").send({
      authIdentifier: "agora_userA@talky.app",
      password: "Password123!",
      displayName: "Agora Alice",
      deviceId: "device-agora-A",
      platform: "ANDROID",
    });
    userAToken = resA.body.data.tokens.accessToken;
    userAId = resA.body.data.user.id;

    // Register User B
    const resB = await request(app).post("/api/v1/auth/register").send({
      authIdentifier: "agora_userB@talky.app",
      password: "Password123!",
      displayName: "Agora Bob",
      deviceId: "device-agora-B",
      platform: "IOS",
    });
    userBToken = resB.body.data.tokens.accessToken;
    userBId = resB.body.data.user.id;

    // Register User C (Unauthorized 3rd User)
    const resC = await request(app).post("/api/v1/auth/register").send({
      authIdentifier: "agora_userC@talky.app",
      password: "Password123!",
      displayName: "Agora Charlie",
      deviceId: "device-agora-C",
      platform: "ANDROID",
    });
    userCToken = resC.body.data.tokens.accessToken;
    userCId = resC.body.data.user.id;

    // Create pairing between User A and User B
    const codeRes = await request(app)
      .post("/api/v1/pairings/code")
      .set("Authorization", `Bearer ${userAToken}`);

    const joinRes = await request(app)
      .post("/api/v1/pairings/join")
      .set("Authorization", `Bearer ${userBToken}`)
      .send({ code: codeRes.body.data.code });

    activePairingId = joinRes.body.data.pairing.id;
    agoraChannelName = joinRes.body.data.pairing.agoraChannelName;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("GET /api/v1/pairings/:id/agora-token", () => {
    it("should generate authorized Agora RTC voice token for paired User A", async () => {
      const res = await request(app)
        .get(`/api/v1/pairings/${activePairingId}/agora-token`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.channelName).toBe(agoraChannelName);
      expect(res.body.data.userAccount).toBe(userAId);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.token.length).toBeGreaterThan(10);
      expect(res.body.data.expiresInSeconds).toBeDefined();
    });

    it("should generate authorized Agora RTC voice token for paired User B", async () => {
      const res = await request(app)
        .get(`/api/v1/pairings/${activePairingId}/agora-token`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.channelName).toBe(agoraChannelName);
      expect(res.body.data.userAccount).toBe(userBId);
      expect(res.body.data.token).toBeDefined();
    });

    it("should reject token generation for unauthorized third user with 403 Forbidden", async () => {
      const res = await request(app)
        .get(`/api/v1/pairings/${activePairingId}/agora-token`)
        .set("Authorization", `Bearer ${userCToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain("not authorized");
    });
  });

  describe("POST /api/v1/voice-sessions/start & stop", () => {
    let createdSessionId: string;

    it("should start a voice session and record ACTIVE status in database", async () => {
      const res = await request(app)
        .post("/api/v1/voice-sessions/start")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ pairingId: activePairingId });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.session.id).toBeDefined();
      expect(res.body.data.session.status).toBe("ACTIVE");
      expect(res.body.data.session.senderUserId).toBe(userAId);
      expect(res.body.data.session.agoraChannelName).toBe(agoraChannelName);

      createdSessionId = res.body.data.session.id;

      // Verify in DB
      const dbSession = await prisma.voiceSession.findUnique({
        where: { id: createdSessionId },
      });
      expect(dbSession?.status).toBe("ACTIVE");
    });

    it("should prevent unauthorized third user from starting a session in this pairing", async () => {
      const res = await request(app)
        .post("/api/v1/voice-sessions/start")
        .set("Authorization", `Bearer ${userCToken}`)
        .send({ pairingId: activePairingId });

      expect(res.status).toBe(403);
    });

    it("should stop the voice session and mark COMPLETED with calculated duration", async () => {
      const res = await request(app)
        .post(`/api/v1/voice-sessions/${createdSessionId}/stop`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.session.status).toBe("COMPLETED");
      expect(res.body.data.session.endedAt).toBeDefined();
      expect(res.body.data.durationMs).toBeGreaterThanOrEqual(0);

      // Verify in DB
      const dbSession = await prisma.voiceSession.findUnique({
        where: { id: createdSessionId },
      });
      expect(dbSession?.status).toBe("COMPLETED");
    });

    it("should allow canceling a voice session", async () => {
      // Start another session
      const startRes = await request(app)
        .post("/api/v1/voice-sessions/start")
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ pairingId: activePairingId });

      const sessionId = startRes.body.data.session.id;

      // Cancel it
      const cancelRes = await request(app)
        .post(`/api/v1/voice-sessions/${sessionId}/cancel`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.session.status).toBe("CANCELED");
    });
  });
});

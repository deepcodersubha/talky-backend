import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/database";

const app = createApp();

describe("Phase 10: Full End-to-End Push-to-Talk Lifecycle & Security Tests", () => {
  let userAToken: string;
  let userBToken: string;
  let userCToken: string;
  let userAId: string;
  let userBId: string;
  let userCId: string;
  let pairingId: string;
  let pairingCode: string;
  let voiceSessionId: string;

  beforeAll(async () => {
    // 1. Clean Database
    await prisma.voiceSession.deleteMany();
    await prisma.pairingCode.deleteMany();
    await prisma.userSetting.deleteMany();
    await prisma.pairing.deleteMany();
    await prisma.device.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.voiceSession.deleteMany();
    await prisma.pairingCode.deleteMany();
    await prisma.userSetting.deleteMany();
    await prisma.pairing.deleteMany();
    await prisma.device.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  describe("Step 1: User & Device Registration", () => {
    it("should register Device A (Alice, iOS)", async () => {
      const res = await request(app).post("/api/v1/auth/register").send({
        authIdentifier: "alice_e2e@talky.app",
        displayName: "Alice E2E",
        deviceId: "dev_alice_ios_e2e",
        platform: "IOS",
        pushToken: "apns_fake_token_alice_e2e",
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      userAToken = res.body.data.tokens.accessToken;
      userAId = res.body.data.user.id;
    });

    it("should register Device B (Bob, Android)", async () => {
      const res = await request(app).post("/api/v1/auth/register").send({
        authIdentifier: "bob_e2e@talky.app",
        displayName: "Bob E2E",
        deviceId: "dev_bob_android_e2e",
        platform: "ANDROID",
        pushToken: "fcm_fake_token_bob_e2e",
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      userBToken = res.body.data.tokens.accessToken;
      userBId = res.body.data.user.id;
    });

    it("should register Device C (Eve, Attacker/Third Party)", async () => {
      const res = await request(app).post("/api/v1/auth/register").send({
        authIdentifier: "eve_e2e@talky.app",
        displayName: "Eve E2E",
        deviceId: "dev_eve_android_e2e",
        platform: "ANDROID",
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      userCToken = res.body.data.tokens.accessToken;
      userCId = res.body.data.user.id;
    });
  });

  describe("Step 2: Cryptographic Two-Device Pairing", () => {
    it("should generate a 6-character uppercase alphanumeric pairing code for User A", async () => {
      const res = await request(app)
        .post("/api/v1/pairings/code")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.code).toMatch(/^[A-Z0-9]{6}$/);
      expect(res.body.data.expiresInSeconds).toBe(600);
      pairingCode = res.body.data.code;
    });

    it("should prevent User A from pairing with themselves", async () => {
      const res = await request(app)
        .post("/api/v1/pairings/join")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ code: pairingCode });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/cannot pair with yourself/i);
    });

    it("should allow User B to join atomically using the code", async () => {
      const res = await request(app)
        .post("/api/v1/pairings/join")
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ code: pairingCode });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pairing.peer.displayName).toBe("Alice E2E");
      pairingId = res.body.data.pairing.id;
    });

    it("should verify both Device A and Device B see each other as active peers", async () => {
      const resA = await request(app)
        .get("/api/v1/pairings/current")
        .set("Authorization", `Bearer ${userAToken}`);
      expect(resA.status).toBe(200);
      expect(resA.body.data.hasActivePairing).toBe(true);
      expect(resA.body.data.pairing.peer.id).toBe(userBId);

      const resB = await request(app)
        .get("/api/v1/pairings/current")
        .set("Authorization", `Bearer ${userBToken}`);
      expect(resB.status).toBe(200);
      expect(resB.body.data.hasActivePairing).toBe(true);
      expect(resB.body.data.pairing.peer.id).toBe(userAId);
    });
  });

  describe("Step 3: Third-User Isolation & Security Defenses", () => {
    it("should reject User C from joining the consumed pairing code", async () => {
      const res = await request(app)
        .post("/api/v1/pairings/join")
        .set("Authorization", `Bearer ${userCToken}`)
        .send({ code: pairingCode });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/invalid, expired, or already used/i);
    });

    it("should prevent User A from generating a second pairing code while active", async () => {
      const res = await request(app)
        .post("/api/v1/pairings/code")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/already have an active pairing/i);
    });

    it("should reject User C from accessing the private Agora voice channel", async () => {
      const res = await request(app)
        .get(`/api/v1/pairings/${pairingId}/agora-token`)
        .set("Authorization", `Bearer ${userCToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe("Step 4: Agora Voice RTC Token Generation", () => {
    it("should issue signed Agora credentials for User A", async () => {
      const res = await request(app)
        .get(`/api/v1/pairings/${pairingId}/agora-token`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.channelName).toMatch(/^talky_pair_/);
      expect(res.body.data.userAccount).toBe(userAId);
    });

    it("should issue signed Agora credentials for User B", async () => {
      const res = await request(app)
        .get(`/api/v1/pairings/${pairingId}/agora-token`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.userAccount).toBe(userBId);
    });
  });

  describe("Step 5: Voice Session Lifecycle & Audit Trail", () => {
    it("should start a voice session and record ACTIVE in database", async () => {
      const res = await request(app)
        .post("/api/v1/voice-sessions/start")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ pairingId });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.session.status).toBe("ACTIVE");
      voiceSessionId = res.body.data.session.id;
    });

    it("should prevent User C from stopping User A's session", async () => {
      const res = await request(app)
        .post(`/api/v1/voice-sessions/${voiceSessionId}/stop`)
        .set("Authorization", `Bearer ${userCToken}`);

      expect(res.status).toBe(403);
    });

    it("should stop User A's voice session and mark COMPLETED with duration", async () => {
      const res = await request(app)
        .post(`/api/v1/voice-sessions/${voiceSessionId}/stop`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.session.status).toBe("COMPLETED");
      expect(typeof res.body.data.durationMs).toBe("number");
    });
  });

  describe("Step 6: Silence Mode & Recipient Override", () => {
    it("should allow User B to silence incoming audio", async () => {
      const res = await request(app)
        .post(`/api/v1/pairings/${pairingId}/silence`)
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ silenced: true });

      expect(res.status).toBe(200);
      expect(res.body.data.silenced).toBe(true);
    });

    it("should allow User B to unmute audio", async () => {
      const res = await request(app)
        .post(`/api/v1/pairings/${pairingId}/silence`)
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ silenced: false });

      expect(res.status).toBe(200);
      expect(res.body.data.silenced).toBe(false);
    });
  });

  describe("Step 7: Atomic Unpairing & Relationship Termination", () => {
    it("should allow User A to unpair cleanly", async () => {
      const res = await request(app)
        .post("/api/v1/pairings/unpair")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ pairingId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should verify both Device A and Device B now report no active pairing", async () => {
      const resA = await request(app)
        .get("/api/v1/pairings/current")
        .set("Authorization", `Bearer ${userAToken}`);
      expect(resA.body.data.hasActivePairing).toBe(false);
      expect(resA.body.data.pairing).toBeNull();

      const resB = await request(app)
        .get("/api/v1/pairings/current")
        .set("Authorization", `Bearer ${userBToken}`);
      expect(resB.body.data.hasActivePairing).toBe(false);
      expect(resB.body.data.pairing).toBeNull();
    });
  });
});

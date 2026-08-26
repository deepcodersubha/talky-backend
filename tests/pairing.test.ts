import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/database";

const app = createApp();

describe("Phase 3: Secure Two-Device Pairing Flow", () => {
  let userAToken: string;
  let userBToken: string;
  let userCToken: string;
  let userAId: string;
  let userBId: string;
  let userCId: string;

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
      authIdentifier: "userA@talky.app",
      password: "Password123!",
      displayName: "User Alpha",
      deviceId: "device-A-001",
      platform: "ANDROID",
    });
    userAToken = resA.body.data.tokens.accessToken;
    userAId = resA.body.data.user.id;

    // Register User B
    const resB = await request(app).post("/api/v1/auth/register").send({
      authIdentifier: "userB@talky.app",
      password: "Password123!",
      displayName: "User Beta",
      deviceId: "device-B-001",
      platform: "IOS",
    });
    userBToken = resB.body.data.tokens.accessToken;
    userBId = resB.body.data.user.id;

    // Register User C (Third Device)
    const resC = await request(app).post("/api/v1/auth/register").send({
      authIdentifier: "userC@talky.app",
      password: "Password123!",
      displayName: "User Charlie",
      deviceId: "device-C-001",
      platform: "ANDROID",
    });
    userCToken = resC.body.data.tokens.accessToken;
    userCId = resC.body.data.user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  let generatedCode: string;
  let activePairingId: string;

  describe("POST /api/v1/pairings/code", () => {
    it("should generate a 6-character cryptographically secure pairing code", async () => {
      const res = await request(app)
        .post("/api/v1/pairings/code")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.code).toBeDefined();
      expect(res.body.data.code.length).toBe(6);
      expect(res.body.data.expiresInSeconds).toBe(600);

      generatedCode = res.body.data.code;

      // Verify that raw code is NOT stored in DB, only sha256 hash
      const dbCode = await prisma.pairingCode.findFirst({
        where: { creatorUserId: userAId },
      });
      expect(dbCode).toBeDefined();
      expect(dbCode?.codeHash).not.toBe(generatedCode);
      expect(dbCode?.codeHash.length).toBe(64); // SHA-256 hex length
      expect(dbCode?.isConsumed).toBe(false);
    });

    it("should reject unauthenticated code generation", async () => {
      const res = await request(app).post("/api/v1/pairings/code");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/pairings/join", () => {
    it("should prevent a user from pairing with themselves", async () => {
      const res = await request(app)
        .post("/api/v1/pairings/join")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ code: generatedCode });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("cannot pair with yourself");
    });

    it("should successfully pair User B with User A atomically", async () => {
      const res = await request(app)
        .post("/api/v1/pairings/join")
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ code: generatedCode });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pairing.id).toBeDefined();
      expect(res.body.data.pairing.status).toBe("ACTIVE");
      expect(res.body.data.pairing.agoraChannelName).toMatch(/^talky_pair_/);
      expect(res.body.data.pairing.peer.id).toBe(userAId);
      expect(res.body.data.pairing.peer.displayName).toBe("User Alpha");

      activePairingId = res.body.data.pairing.id;

      // Verify code is now marked consumed in DB
      const dbCode = await prisma.pairingCode.findFirst({
        where: { creatorUserId: userAId },
      });
      expect(dbCode?.isConsumed).toBe(true);
      expect(dbCode?.consumedAt).not.toBeNull();
    });

    it("should reject re-using an already consumed code", async () => {
      const res = await request(app)
        .post("/api/v1/pairings/join")
        .set("Authorization", `Bearer ${userCToken}`)
        .send({ code: generatedCode });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("Invalid, expired, or already used");
    });

    it("should reject a third user from joining or creating pairing while active", async () => {
      // User A attempts to generate a new code while paired
      const resCodeA = await request(app)
        .post("/api/v1/pairings/code")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(resCodeA.status).toBe(400);
      expect(resCodeA.body.error.message).toContain("already have an active pairing");
    });
  });

  describe("GET /api/v1/pairings/current", () => {
    it("should return active pairing details for User A", async () => {
      const res = await request(app)
        .get("/api/v1/pairings/current")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.hasActivePairing).toBe(true);
      expect(res.body.data.pairing.id).toBe(activePairingId);
      expect(res.body.data.pairing.peer.id).toBe(userBId);
      expect(res.body.data.pairing.peer.displayName).toBe("User Beta");
    });

    it("should return active pairing details for User B", async () => {
      const res = await request(app)
        .get("/api/v1/pairings/current")
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.hasActivePairing).toBe(true);
      expect(res.body.data.pairing.id).toBe(activePairingId);
      expect(res.body.data.pairing.peer.id).toBe(userAId);
    });

    it("should return hasActivePairing: false for unpaired User C", async () => {
      const res = await request(app)
        .get("/api/v1/pairings/current")
        .set("Authorization", `Bearer ${userCToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.hasActivePairing).toBe(false);
      expect(res.body.data.pairing).toBeNull();
    });
  });

  describe("POST /api/v1/pairings/:id/silence", () => {
    it("should allow User A to toggle silence mode", async () => {
      const res = await request(app)
        .post(`/api/v1/pairings/${activePairingId}/silence`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ silenced: true });

      expect(res.status).toBe(200);
      expect(res.body.data.silenced).toBe(true);

      // Verify User A current pairing shows silenced: true
      const currentResA = await request(app)
        .get("/api/v1/pairings/current")
        .set("Authorization", `Bearer ${userAToken}`);
      expect(currentResA.body.data.pairing.isSilenced).toBe(true);

      // Verify User B current pairing is still silenced: false (independent setting)
      const currentResB = await request(app)
        .get("/api/v1/pairings/current")
        .set("Authorization", `Bearer ${userBToken}`);
      expect(currentResB.body.data.pairing.isSilenced).toBe(false);
    });

    it("should reject unauthorized third party from changing silence setting", async () => {
      const res = await request(app)
        .post(`/api/v1/pairings/${activePairingId}/silence`)
        .set("Authorization", `Bearer ${userCToken}`)
        .send({ silenced: true });

      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/v1/pairings/unpair", () => {
    it("should reject unpairing by unauthorized third user", async () => {
      const res = await request(app)
        .post("/api/v1/pairings/unpair")
        .set("Authorization", `Bearer ${userCToken}`)
        .send({ pairingId: activePairingId });

      expect(res.status).toBe(403);
    });

    it("should allow either paired user to unpair successfully", async () => {
      const res = await request(app)
        .post("/api/v1/pairings/unpair")
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ pairingId: activePairingId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.unpairedAt).toBeDefined();

      // Verify both User A and User B now return hasActivePairing: false
      const resA = await request(app)
        .get("/api/v1/pairings/current")
        .set("Authorization", `Bearer ${userAToken}`);
      expect(resA.body.data.hasActivePairing).toBe(false);

      const resB = await request(app)
        .get("/api/v1/pairings/current")
        .set("Authorization", `Bearer ${userBToken}`);
      expect(resB.body.data.hasActivePairing).toBe(false);
    });
  });
});

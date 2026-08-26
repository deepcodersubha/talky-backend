import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/database";

const app = createApp();

describe("Phase 9: Silence & Mute Mode Management API", () => {
  let userAToken: string;
  let userBToken: string;
  let userCToken: string;
  let pairingId: string;

  beforeAll(async () => {
    // 1. Clean test DB
    await prisma.voiceSession.deleteMany();
    await prisma.pairingCode.deleteMany();
    await prisma.userSetting.deleteMany();
    await prisma.pairing.deleteMany();
    await prisma.device.deleteMany();
    await prisma.user.deleteMany();

    // 2. Register User A
    const resA = await request(app).post("/api/v1/auth/register").send({
      authIdentifier: "alice_silence@talky.app",
      displayName: "Alice Silence",
      deviceId: "dev_alice_silence",
      platform: "IOS",
    });
    userAToken = resA.body.data.tokens.accessToken;

    // 3. Register User B
    const resB = await request(app).post("/api/v1/auth/register").send({
      authIdentifier: "bob_silence@talky.app",
      displayName: "Bob Silence",
      deviceId: "dev_bob_silence",
      platform: "ANDROID",
    });
    userBToken = resB.body.data.tokens.accessToken;

    // 4. Register User C (Third Party)
    const resC = await request(app).post("/api/v1/auth/register").send({
      authIdentifier: "eve_silence@talky.app",
      displayName: "Eve Silence",
      deviceId: "dev_eve_silence",
      platform: "ANDROID",
    });
    userCToken = resC.body.data.tokens.accessToken;

    // 5. User A generates code and User B joins
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
    await prisma.voiceSession.deleteMany();
    await prisma.pairingCode.deleteMany();
    await prisma.userSetting.deleteMany();
    await prisma.pairing.deleteMany();
    await prisma.device.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  describe("POST /api/v1/pairings/:id/silence", () => {
    it("should allow User A to set indefinite silence mode", async () => {
      const res = await request(app)
        .post(`/api/v1/pairings/${pairingId}/silence`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ silenced: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.silenced).toBe(true);
      expect(res.body.data.durationMinutes).toBeNull();

      // Verify User A current pairing shows isSilenced: true
      const currentA = await request(app)
        .get("/api/v1/pairings/current")
        .set("Authorization", `Bearer ${userAToken}`);
      expect(currentA.body.data.pairing.isSilenced).toBe(true);

      // Verify User B's silence setting remains false (independent recipient setting)
      const currentB = await request(app)
        .get("/api/v1/pairings/current")
        .set("Authorization", `Bearer ${userBToken}`);
      expect(currentB.body.data.pairing.isSilenced).toBe(false);
    });

    it("should allow User B to set temporary silence with duration (e.g. 60 mins)", async () => {
      const res = await request(app)
        .post(`/api/v1/pairings/${pairingId}/silence`)
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ silenced: true, durationMinutes: 60 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.silenced).toBe(true);
      expect(res.body.data.durationMinutes).toBe(60);
    });

    it("should allow unmuting audio back to active state", async () => {
      const res = await request(app)
        .post(`/api/v1/pairings/${pairingId}/silence`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ silenced: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.silenced).toBe(false);

      const currentA = await request(app)
        .get("/api/v1/pairings/current")
        .set("Authorization", `Bearer ${userAToken}`);
      expect(currentA.body.data.pairing.isSilenced).toBe(false);
    });

    it("should reject silence modification from an unauthorized third party", async () => {
      const res = await request(app)
        .post(`/api/v1/pairings/${pairingId}/silence`)
        .set("Authorization", `Bearer ${userCToken}`)
        .send({ silenced: true });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/unauthorized/i);
    });
  });
});

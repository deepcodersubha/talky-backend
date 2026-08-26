import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/database";

const app = createApp();

describe("Phase 2: Authentication & Device Management API", () => {
  beforeAll(async () => {
    // Clear test database tables
    await prisma.device.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("GET /api/v1/health", () => {
    it("should return healthy status", async () => {
      const res = await request(app).get("/api/v1/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.service).toBe("talky-backend");
    });
  });

  describe("POST /api/v1/auth/register", () => {
    it("should register a new user successfully with tokens and device record", async () => {
      const res = await request(app).post("/api/v1/auth/register").send({
        authIdentifier: "alice@talky.app",
        password: "SuperSecretPassword123!",
        displayName: "Alice Tester",
        deviceId: "device-alice-001",
        platform: "ANDROID",
        pushToken: "fcm_token_alice_123",
        appVersion: "1.0.0",
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.displayName).toBe("Alice Tester");
      expect(res.body.data.user.authIdentifier).toBe("alice@talky.app");
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeDefined();

      // Check database to ensure password is NOT stored in plain text
      const dbUser = await prisma.user.findUnique({
        where: { authIdentifier: "alice@talky.app" },
      });
      expect(dbUser).toBeDefined();
      expect(dbUser?.passwordHash).not.toBe("SuperSecretPassword123!");
      expect(dbUser?.passwordHash).toMatch(/^\$2[ayb]\$.{56}$/); // bcrypt hash pattern
    });

    it("should reject duplicate registration with 409 Conflict", async () => {
      const res = await request(app).post("/api/v1/auth/register").send({
        authIdentifier: "alice@talky.app",
        password: "AnotherPassword123!",
        displayName: "Alice Clone",
        deviceId: "device-alice-002",
        platform: "IOS",
      });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("AppError");
    });

    it("should fail validation when required fields are missing", async () => {
      const res = await request(app).post("/api/v1/auth/register").send({
        authIdentifier: "a", // too short
        displayName: "",
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /api/v1/auth/login", () => {
    it("should authenticate with correct password", async () => {
      const res = await request(app).post("/api/v1/auth/login").send({
        authIdentifier: "alice@talky.app",
        password: "SuperSecretPassword123!",
        deviceId: "device-alice-001",
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tokens.accessToken).toBeDefined();
    });

    it("should reject incorrect password with 401 Unauthorized", async () => {
      const res = await request(app).post("/api/v1/auth/login").send({
        authIdentifier: "alice@talky.app",
        password: "WrongPassword!",
        deviceId: "device-alice-001",
      });

      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/auth/refresh", () => {
    it("should rotate and issue fresh tokens given a valid refresh token", async () => {
      const loginRes = await request(app).post("/api/v1/auth/login").send({
        authIdentifier: "alice@talky.app",
        password: "SuperSecretPassword123!",
        deviceId: "device-alice-001",
      });

      const refreshToken = loginRes.body.data.tokens.refreshToken;

      const refreshRes = await request(app).post("/api/v1/auth/refresh").send({
        refreshToken,
      });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.data.tokens.accessToken).toBeDefined();
      expect(refreshRes.body.data.tokens.refreshToken).toBeDefined();
    });
  });

  describe("GET /api/v1/auth/me & Protected Endpoints", () => {
    it("should reject requests without authorization token", async () => {
      const res = await request(app).get("/api/v1/auth/me");
      expect(res.status).toBe(401);
    });

    it("should return current user profile with valid Bearer token", async () => {
      const loginRes = await request(app).post("/api/v1/auth/login").send({
        authIdentifier: "alice@talky.app",
        password: "SuperSecretPassword123!",
        deviceId: "device-alice-001",
      });

      const token = loginRes.body.data.tokens.accessToken;

      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.user.displayName).toBe("Alice Tester");
    });
  });

  describe("POST /api/v1/devices/register", () => {
    it("should update device push token for authenticated user", async () => {
      const loginRes = await request(app).post("/api/v1/auth/login").send({
        authIdentifier: "alice@talky.app",
        password: "SuperSecretPassword123!",
        deviceId: "device-alice-001",
      });

      const token = loginRes.body.data.tokens.accessToken;

      const res = await request(app)
        .post("/api/v1/devices/register")
        .set("Authorization", `Bearer ${token}`)
        .send({
          deviceId: "device-alice-001",
          platform: "ANDROID",
          pushToken: "updated_fcm_token_999",
          appVersion: "1.0.1",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.device.pushToken).toBe("updated_fcm_token_999");
    });
  });
});

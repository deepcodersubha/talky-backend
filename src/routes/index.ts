import { Router } from "express";
import { authRoutes } from "./auth.routes";
import { deviceRoutes } from "./device.routes";
import { pairingRoutes } from "./pairing.routes";
import { voiceSessionRoutes } from "./voiceSession.routes";

const router = Router();

router.get("/health", async (req, res) => {
  try {
    const { prisma } = await import("../config/database");
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      service: "talky-backend",
      database: "connected",
    });
  } catch (error) {
    res.status(503).json({
      status: "degraded",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      service: "talky-backend",
      database: "error",
      error: error instanceof Error ? error.message : "Database connection failed",
    });
  }
});

router.use("/auth", authRoutes);
router.use("/devices", deviceRoutes);
router.use("/pairings", pairingRoutes);
router.use("/voice-sessions", voiceSessionRoutes);

export const apiRouter = router;

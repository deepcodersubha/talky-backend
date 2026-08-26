import { Router } from "express";
import { authRoutes } from "./auth.routes";
import { deviceRoutes } from "./device.routes";
import { pairingRoutes } from "./pairing.routes";
import { voiceSessionRoutes } from "./voiceSession.routes";

const router = Router();

router.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "talky-backend",
  });
});

router.use("/auth", authRoutes);
router.use("/devices", deviceRoutes);
router.use("/pairings", pairingRoutes);
router.use("/voice-sessions", voiceSessionRoutes);

export const apiRouter = router;

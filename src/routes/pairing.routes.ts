import { Router } from "express";
import {
  PairingController,
  joinPairingSchema,
  pairingStatusSchema,
  silenceSchema,
  unpairSchema,
} from "../controllers/pairing.controller";
import { AgoraController } from "../controllers/agora.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { pairingLimiter } from "../middlewares/rateLimiter";
import { validate } from "../middlewares/validate.middleware";

const router = Router();

// All pairing routes require authentication
router.use(requireAuth);

router.post("/code", pairingLimiter, PairingController.generateCode);
router.post("/join", pairingLimiter, validate(joinPairingSchema), PairingController.join);
router.get("/current", PairingController.getCurrent);
router.post("/unpair", validate(unpairSchema), PairingController.unpair);
router.get("/:id/status", validate(pairingStatusSchema), PairingController.getStatus);
router.post("/:id/silence", validate(silenceSchema), PairingController.toggleSilence);
router.get("/:id/agora-token", validate(pairingStatusSchema), AgoraController.getToken);

export const pairingRoutes = router;

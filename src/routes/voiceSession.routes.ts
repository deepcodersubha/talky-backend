import { Router } from "express";
import {
  VoiceSessionController,
  startSessionSchema,
  stopSessionSchema,
} from "../controllers/voiceSession.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";

const router = Router();

router.use(requireAuth);

router.post("/start", validate(startSessionSchema), VoiceSessionController.start);
router.post("/:id/stop", validate(stopSessionSchema), VoiceSessionController.stop);
router.post("/:id/cancel", validate(stopSessionSchema), VoiceSessionController.cancel);

export const voiceSessionRoutes = router;

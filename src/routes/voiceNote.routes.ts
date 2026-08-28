import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware";
import { VoiceNoteController, uploadVoiceNoteMiddleware } from "../controllers/voiceNote.controller";

const router = Router();

router.use(requireAuth);

router.post("/upload", uploadVoiceNoteMiddleware, VoiceNoteController.upload);
router.get("/pending", VoiceNoteController.getPending);
router.post("/:id/played", VoiceNoteController.markPlayed);

export const voiceNoteRoutes = router;

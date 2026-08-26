import { Router } from "express";
import {
  AuthController,
  loginSchema,
  refreshSchema,
  registerSchema,
} from "../controllers/auth.controller";
import { authLimiter } from "../middlewares/rateLimiter";
import { validate } from "../middlewares/validate.middleware";
import { requireAuth } from "../middlewares/auth.middleware";

const router = Router();

router.post("/register", authLimiter, validate(registerSchema), AuthController.register);
router.post("/login", authLimiter, validate(loginSchema), AuthController.login);
router.post("/refresh", authLimiter, validate(refreshSchema), AuthController.refresh);
router.get("/me", requireAuth, AuthController.me);

export const authRoutes = router;

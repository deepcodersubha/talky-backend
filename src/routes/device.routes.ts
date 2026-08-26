import { Router } from "express";
import { DeviceController, registerDeviceSchema } from "../controllers/device.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";

const router = Router();

router.post("/register", requireAuth, validate(registerDeviceSchema), DeviceController.register);

export const deviceRoutes = router;

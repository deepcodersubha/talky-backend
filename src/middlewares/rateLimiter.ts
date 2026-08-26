import rateLimit from "express-rate-limit";
import { env } from "../config/env";

const isDev = env.NODE_ENV === "development" || env.NODE_ENV === "test";

export const standardLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: isDev ? 10000 : env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev,
  message: {
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many requests, please try again later.",
    },
  },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev,
  message: {
    error: {
      code: "AUTH_RATE_LIMIT_EXCEEDED",
      message: "Too many authentication attempts, please try again later.",
    },
  },
});

export const pairingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev,
  message: {
    error: {
      code: "PAIRING_RATE_LIMIT_EXCEEDED",
      message: "Too many pairing attempts, please try again later.",
    },
  },
});


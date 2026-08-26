import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import { standardLimiter } from "./middlewares/rateLimiter";
import { errorHandler } from "./middlewares/error.middleware";
import { apiRouter } from "./routes";
import { logger } from "./config/logger";

export const createApp = (): Application => {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS configuration
  app.use(
    cors({
      origin: "*", // Configurable for production environments
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  // Body parsers
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  // Global rate limiter
  app.use(standardLimiter);

  // Request logger middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
    });
    next();
  });

  // Base API routes
  app.use("/api/v1", apiRouter);

  // 404 handler for unknown routes
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: `Route ${req.method} ${req.originalUrl} not found`,
      },
    });
  });

  // Centralized error handler
  app.use(errorHandler);

  return app;
};

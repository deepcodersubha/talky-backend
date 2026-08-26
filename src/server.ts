import http from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { prisma } from "./config/database";
import { initWebSocketServer } from "./websocket/server";

const app = createApp();
const server = http.createServer(app);
const wss = initWebSocketServer(server);

const startServer = async () => {
  try {
    // Verify database connection
    await prisma.$connect();
    logger.info("Connected to database successfully.");

    server.listen(env.PORT, () => {
      logger.info(`🚀 Talky Backend Server listening on http://localhost:${env.PORT}`);
      logger.info(`Environment: ${env.NODE_ENV}`);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
};

const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  server.close(async () => {
    logger.info("HTTP server closed.");
    await prisma.$disconnect();
    logger.info("Database connection closed.");
    process.exit(0);
  });
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

startServer();

export { server };

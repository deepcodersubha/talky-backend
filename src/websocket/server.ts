import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { logger } from "../config/logger";
import { WSHandler } from "./handler";
import { SessionManager } from "./sessionManager";

export const initWebSocketServer = (httpServer: HttpServer): WebSocketServer => {
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
  });

  logger.info("📡 WebSocket Server initialized on path /ws");

  wss.on("connection", (socket: WebSocket, req) => {
    const clientIp = req.socket.remoteAddress;
    logger.debug(`New WebSocket connection initiated from ${clientIp}`);

    SessionManager.setMeta(socket, { isAlive: true });

    socket.on("message", async (data) => {
      try {
        const rawString = data.toString("utf-8");
        await WSHandler.handleMessage(socket, rawString);
      } catch (err) {
        logger.warn("Failed to process WebSocket message:", err);
      }
    });

    socket.on("pong", () => {
      SessionManager.setMeta(socket, { isAlive: true });
    });

    socket.on("close", async (code, reason) => {
      logger.debug(`WebSocket disconnected [code: ${code}, reason: ${reason.toString()}]`);
      const { userId } = SessionManager.removeSocket(socket);
      if (userId && !SessionManager.isUserOnline(userId)) {
        await SessionManager.notifyPresenceChange(userId, false);
      }
    });

    socket.on("error", (error) => {
      logger.warn("WebSocket client error:", error);
    });
  });

  // Heartbeat ping interval to clear stale connections (every 30 seconds)
  const interval = setInterval(() => {
    wss.clients.forEach((socket) => {
      const meta = SessionManager.getMeta(socket);
      if (!meta.isAlive) {
        logger.debug("Terminating unresponsive WebSocket connection.");
        socket.terminate();
        return;
      }
      meta.isAlive = false;
      socket.ping();
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(interval);
  });

  return wss;
};

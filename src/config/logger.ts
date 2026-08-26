import winston from "winston";

const { combine, timestamp, printf, colorize, json } = winston.format;

const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let metaStr = "";
  if (Object.keys(metadata).length > 0) {
    metaStr = ` ${JSON.stringify(metadata)}`;
  }
  return `[${timestamp}] [${level}]: ${message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: combine(
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    process.env.NODE_ENV === "production" ? json() : combine(colorize(), consoleFormat)
  ),
  transports: [new winston.transports.Console()],
});

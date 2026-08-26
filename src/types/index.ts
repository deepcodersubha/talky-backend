import { Request } from "express";

export interface AuthenticatedUser {
  id: string;
  authIdentifier: string;
  displayName: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export interface JWTPayload {
  userId: string;
  authIdentifier: string;
  type: "access" | "refresh";
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type PlatformType = "ANDROID" | "IOS" | "WEB";

export type PairingStatusType = "ACTIVE" | "UNPAIRED";

export type VoiceSessionStatusType =
  | "CREATED"
  | "STARTING"
  | "ACTIVE"
  | "STOPPING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED";

export interface WebSocketMessage<T = unknown> {
  event: string;
  payload: T;
  sequence?: number;
  timestamp: number;
}

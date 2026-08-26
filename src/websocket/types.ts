export type WSClientEvent =
  | "authenticate"
  | "subscribe_pairing"
  | "ptt_started"
  | "ptt_stopped"
  | "silence_changed"
  | "heartbeat"
  | "reconnect";

export type WSServerEvent =
  | "authenticated"
  | "pairing_updated"
  | "peer_presence_changed"
  | "speaker_started"
  | "speaker_stopped"
  | "session_state_changed"
  | "silence_updated"
  | "unpaired"
  | "token_expired"
  | "error"
  | "heartbeat_ack";

export interface WSIncomingMessage<T = unknown> {
  event: WSClientEvent;
  payload: T;
  sequence?: number;
  timestamp?: number;
}

export interface WSOutgoingMessage<T = unknown> {
  event: WSServerEvent;
  payload: T;
  sequence?: number;
  timestamp: number;
}

// Payload Interfaces
export interface AuthPayload {
  token: string;
}

export interface SubscribePairingPayload {
  pairingId: string;
}

export interface PTTStartedPayload {
  pairingId: string;
}

export interface PTTStoppedPayload {
  pairingId: string;
  sessionId: string;
}

export interface SilenceChangedPayload {
  pairingId: string;
  silenced: boolean;
}

export interface HeartbeatPayload {
  timestamp: number;
}

// Server Broadcast Payloads
export interface PeerPresencePayload {
  peerUserId: string;
  isOnline: boolean;
  lastSeenAt: string;
}

export interface SpeakerStartedPayload {
  sessionId: string;
  pairingId: string;
  speakerUserId: string;
  speakerDisplayName: string;
  agoraChannelName: string;
  timestamp: number;
}

export interface SpeakerStoppedPayload {
  sessionId: string;
  pairingId: string;
  speakerUserId: string;
  durationMs: number;
  timestamp: number;
}

export interface SilenceUpdatedPayload {
  pairingId: string;
  userId: string;
  silenced: boolean;
}

export interface UnpairedPayload {
  pairingId: string;
  unpairInitiatedBy: string;
}

export interface WSErrorPayload {
  code: string;
  message: string;
}

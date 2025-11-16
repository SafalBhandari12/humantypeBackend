// Core types for TypeRacer backend system

export type RaceState =
  | "waiting"
  | "starting-countdown"
  | "running"
  | "finished"
  | "archived";

export type MessageType =
  | "j"
  | "ja"
  | "p"
  | "pb"
  | "f"
  | "fb"
  | "st"
  | "e"
  | "h";

// WebSocket message envelope
export interface WSMessage<T = any> {
  t: MessageType; // message type
  i?: string; // client message id for idempotency
  r?: string; // race id
  u?: string; // player id
  s?: number; // client sequence number
  d?: T; // payload data
  ts?: number; // server timestamp
}

// Message payloads
export interface JoinPayload {
  n: string; // player name
}

export interface JoinAckPayload {
  ok: boolean;
  state: RaceState;
  players_count: number;
  text_id?: string;
  text?: string;
}

export interface ProgressPayload {
  idx: number; // current character index
  chars: number; // total characters typed
  errors: number; // error count
  elapsed_ms: number; // time elapsed since start
}

export interface ProgressBroadcastPayload {
  u: string; // player id
  idx: number;
  chars: number;
  errors: number;
  elapsed_ms: number;
}

export interface FinishedPayload {
  time_ms: number; // total time taken
  errors: number; // final error count
}

export interface FinishedBroadcastPayload {
  u: string; // player id
  place: number; // finishing position
  time_ms: number; // total time taken
  wpm?: number; // words per minute
}

export interface StateBroadcastPayload {
  state: RaceState;
  start_ts?: number;
  countdown_ms?: number;
  duration_ms?: number;
  players?: Array<{
    u: string;
    name: string;
    progress?: ProgressPayload;
  }>;
  results?: Array<{
    u: string;
    name: string;
    place: number;
    time_ms: number;
    wpm: number;
  }>;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

// Redis data structures
export interface RaceData {
  id: string;
  text_id: string;
  state: RaceState;
  created_at: string;
  start_ts: string;
  duration_ms: string;
  countdown_ms: string;
  max_players: string;
  host_id?: string;
}

export interface PlayerData {
  id: string;
  name: string;
  rating: string;
  created_at: string;
  games_played: string;
  best_wpm: string;
}

export interface SessionData {
  player_id: string;
  race: string;
  ws_conn: string;
  last_seen: string;
  last_seq: string;
  role?: "player" | "spectator";
}

export interface TextData {
  id: string;
  text: string;
  length: string;
  hash: string;
  difficulty: string;
  author: string;
}

// REST API types
export interface CreateRaceRequest {
  text_id: string;
  max_players?: number;
  duration_ms?: number;
  countdown_ms?: number;
}

export interface CreateRaceResponse {
  raceId: string;
  metadata: RaceData;
}

export interface RaceMetadataResponse {
  id: string;
  state: RaceState;
  players_count: number;
  start_ts: number;
  text_id: string;
  duration_ms: number;
  countdown_ms: number;
  max_players: number;
}

// Internal server types
export interface ConnectedPlayer {
  id: string;
  name: string;
  ws: any; // WebSocket connection
  sessionId: string;
  lastSeq: number;
  lastSeen: number;
  raceId?: string;
  role: "player" | "spectator";
}

export interface RaceManager {
  raceId: string;
  state: RaceState;
  players: Map<string, ConnectedPlayer>;
  countdownTimer?: NodeJS.Timeout;
  raceTimer?: NodeJS.Timeout;
  lastProgressBroadcast: number;
  progressBuffer: Map<string, ProgressPayload>;
}

// Configuration constants
export const CONFIG = {
  COUNTDOWN_MS: 3000,
  DEFAULT_DURATION_MS: 60000,
  MAX_PLAYERS: 8,
  RECONNECT_GRACE_MS: 30000,
  SESSION_TTL_MS: 60000,
  PROGRESS_BROADCAST_INTERVAL_MS: 100,
  HEARTBEAT_INTERVAL_MS: 30000,
  MAX_CHARS_PER_SECOND: 10, // Anti-cheat: max typing speed
  MIN_PROGRESS_INTERVAL_MS: 50, // Rate limiting
} as const;

// Error codes
export const ERROR_CODES = {
  INVALID_RACE: "INVALID_RACE",
  RACE_FULL: "RACE_FULL",
  RACE_STARTED: "RACE_STARTED",
  INVALID_PLAYER: "INVALID_PLAYER",
  SEQUENCE_ERROR: "SEQUENCE_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_PROGRESS: "INVALID_PROGRESS",
  ALREADY_FINISHED: "ALREADY_FINISHED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
} as const;

import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import logger from "../utils/logger.js";
import redisService from "./redisService.js";
import type {
  WSMessage,
  MessageType,
  JoinPayload,
  JoinAckPayload,
  ProgressPayload,
  ProgressBroadcastPayload,
  FinishedPayload,
  FinishedBroadcastPayload,
  StateBroadcastPayload,
  ErrorPayload,
  ConnectedPlayer,
  RaceManager,
  RaceState,
} from "../types/index.js";
import { CONFIG, ERROR_CODES } from "../types/index.js";

class WebSocketHandler {
  private players: Map<string, ConnectedPlayer> = new Map();
  private races: Map<string, RaceManager> = new Map();
  private sessionToPlayer: Map<string, string> = new Map();

  constructor() {
    // Start heartbeat interval
    setInterval(() => {
      this.sendHeartbeats();
    }, CONFIG.HEARTBEAT_INTERVAL_MS);

    // Start progress broadcast aggregator
    setInterval(() => {
      this.broadcastAggregatedProgress();
    }, CONFIG.PROGRESS_BROADCAST_INTERVAL_MS);
  }

  async handleConnection(ws: WebSocket): Promise<void> {
    const sessionId = uuidv4();
    logger.info(`New WebSocket connection: ${sessionId}`);

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString()) as WSMessage;
        await this.handleMessage(ws, sessionId, message);
      } catch (error) {
        logger.error(`Error handling message: ${error}`);
        this.sendError(
          ws,
          ERROR_CODES.VALIDATION_ERROR,
          "Invalid message format"
        );
      }
    });

    ws.on("close", () => {
      this.handleDisconnection(sessionId);
    });

    ws.on("error", (error) => {
      logger.error(`WebSocket error for session ${sessionId}: ${error}`);
    });
  }

  private async handleMessage(
    ws: WebSocket,
    sessionId: string,
    message: WSMessage
  ): Promise<void> {
    const {
      t: type,
      i: msgId,
      r: raceId,
      u: playerId,
      s: seq,
      d: data,
    } = message;

    // Validate sequence number for existing sessions
    if (playerId && seq !== undefined) {
      const valid = await this.validateSequence(sessionId, seq);
      if (!valid) {
        this.sendError(
          ws,
          ERROR_CODES.SEQUENCE_ERROR,
          "Invalid sequence number",
          msgId
        );
        return;
      }
    }

    switch (type) {
      case "j":
        await this.handleJoin(
          ws,
          sessionId,
          raceId!,
          playerId!,
          data as JoinPayload,
          msgId
        );
        break;
      case "p":
        await this.handleProgress(
          ws,
          sessionId,
          raceId!,
          playerId!,
          data as ProgressPayload
        );
        break;
      case "f":
        await this.handleFinished(
          ws,
          sessionId,
          raceId!,
          playerId!,
          data as FinishedPayload
        );
        break;
      case "h":
        this.sendMessage(ws, { t: "h", ts: Date.now() });
        break;
      default:
        this.sendError(
          ws,
          ERROR_CODES.VALIDATION_ERROR,
          `Unknown message type: ${type}`,
          msgId
        );
    }
  }

  private async handleJoin(
    ws: WebSocket,
    sessionId: string,
    raceId: string,
    playerId: string,
    data: JoinPayload,
    msgId?: string
  ): Promise<void> {
    try {
      // Get race data
      const raceData = await redisService.getRace(raceId);
      if (!raceData) {
        this.sendError(ws, ERROR_CODES.INVALID_RACE, "Race not found", msgId);
        return;
      }

      // Check race state
      if (
        raceData.state === "starting-countdown" ||
        raceData.state === "running"
      ) {
        // Allow spectator join
        await this.joinAsSpectator(
          ws,
          sessionId,
          raceId,
          playerId,
          data.n,
          msgId
        );
        return;
      }

      if (raceData.state === "finished" || raceData.state === "archived") {
        this.sendError(ws, ERROR_CODES.RACE_STARTED, "Race has ended", msgId);
        return;
      }

      // Check if race is full
      const playersCount = await redisService.getPlayersCount(raceId);
      if (playersCount >= parseInt(raceData.max_players)) {
        this.sendError(ws, ERROR_CODES.RACE_FULL, "Race is full", msgId);
        return;
      }

      // Create player and session
      const player: ConnectedPlayer = {
        id: playerId,
        name: data.n,
        ws,
        sessionId,
        lastSeq: 0,
        lastSeen: Date.now(),
        raceId,
        role: "player",
      };

      this.players.set(playerId, player);
      this.sessionToPlayer.set(sessionId, playerId);

      // Add to Redis
      const joinTs = Date.now();
      await redisService.addPlayerToRace(raceId, playerId, joinTs);
      await redisService.createSession(sessionId, {
        player_id: playerId,
        race: raceId,
        ws_conn: sessionId,
        last_seen: joinTs.toString(),
        last_seq: "0",
        role: "player",
      });

      // Log event
      await redisService.logEvent(raceId, "join", {
        player: playerId,
        name: data.n,
        ts: joinTs,
      });

      // Add to race manager
      if (!this.races.has(raceId)) {
        this.races.set(raceId, {
          raceId,
          state: raceData.state as RaceState,
          players: new Map(),
          lastProgressBroadcast: 0,
          progressBuffer: new Map(),
        });
      }

      const raceManager = this.races.get(raceId)!;
      raceManager.players.set(playerId, player);

      // Send join acknowledgment
      const ackPayload: JoinAckPayload = {
        ok: true,
        state: raceData.state as RaceState,
        players_count: playersCount + 1,
      };

      const message: WSMessage = {
        t: "ja",
        r: raceId,
        u: playerId,
        d: ackPayload,
        ts: Date.now(),
      };
      if (msgId) message.i = msgId;
      this.sendMessage(ws, message);

      // Broadcast state update to all players
      await this.broadcastRaceState(raceId);

      logger.info(`Player ${playerId} (${data.n}) joined race ${raceId}`);
    } catch (error) {
      logger.error(`Error handling join: ${error}`);
      this.sendError(
        ws,
        ERROR_CODES.VALIDATION_ERROR,
        "Failed to join race",
        msgId
      );
    }
  }

  private async joinAsSpectator(
    ws: WebSocket,
    sessionId: string,
    raceId: string,
    playerId: string,
    name: string,
    msgId?: string
  ): Promise<void> {
    const player: ConnectedPlayer = {
      id: playerId,
      name,
      ws,
      sessionId,
      lastSeq: 0,
      lastSeen: Date.now(),
      raceId,
      role: "spectator",
    };

    this.players.set(playerId, player);
    this.sessionToPlayer.set(sessionId, playerId);

    await redisService.createSession(sessionId, {
      player_id: playerId,
      race: raceId,
      ws_conn: sessionId,
      last_seen: Date.now().toString(),
      last_seq: "0",
      role: "spectator",
    });

    const raceData = await redisService.getRace(raceId);
    const playersCount = await redisService.getPlayersCount(raceId);

    const ackPayload: JoinAckPayload = {
      ok: true,
      state: raceData!.state as RaceState,
      players_count: playersCount,
    };

    const message: WSMessage = {
      t: "ja",
      r: raceId,
      u: playerId,
      d: ackPayload,
      ts: Date.now(),
    };
    if (msgId) message.i = msgId;
    this.sendMessage(ws, message);

    // Send current race state
    await this.sendRaceStateToPlayer(playerId, raceId);
  }

  private async handleProgress(
    ws: WebSocket,
    sessionId: string,
    raceId: string,
    playerId: string,
    data: ProgressPayload
  ): Promise<void> {
    try {
      const player = this.players.get(playerId);
      if (!player || player.role !== "player") {
        return; // Ignore progress from spectators
      }

      const raceManager = this.races.get(raceId);
      if (!raceManager || raceManager.state !== "running") {
        return; // Race not running
      }

      // Anti-cheat validation
      const lastProgress = await redisService.getProgress(raceId, playerId);
      if (lastProgress) {
        // Check for impossible progress
        const timeDiff = data.elapsed_ms - lastProgress.elapsed_ms;
        const charDiff = data.idx - lastProgress.idx;

        if (timeDiff > 0) {
          const charsPerSecond = (charDiff / timeDiff) * 1000;
          if (charsPerSecond > CONFIG.MAX_CHARS_PER_SECOND) {
            logger.warn(
              `Suspicious typing speed for player ${playerId}: ${charsPerSecond} chars/sec`
            );
            return; // Reject suspicious progress
          }
        }

        // Check for monotonic progression
        if (data.idx < lastProgress.idx) {
          logger.warn(`Non-monotonic progress for player ${playerId}`);
          return;
        }
      }

      // Rate limiting check
      const now = Date.now();
      if (now - player.lastSeen < CONFIG.MIN_PROGRESS_INTERVAL_MS) {
        return; // Rate limited
      }

      player.lastSeen = now;

      // Update progress in Redis
      await redisService.updateProgress(raceId, playerId, data);

      // Log event
      await redisService.logEvent(raceId, "progress", {
        player: playerId,
        idx: data.idx,
        errors: data.errors,
        elapsed_ms: data.elapsed_ms,
      });

      // Add to progress buffer for aggregated broadcast
      raceManager.progressBuffer.set(playerId, data);
    } catch (error) {
      logger.error(`Error handling progress: ${error}`);
    }
  }

  private async handleFinished(
    ws: WebSocket,
    sessionId: string,
    raceId: string,
    playerId: string,
    data: FinishedPayload
  ): Promise<void> {
    try {
      const player = this.players.get(playerId);
      if (!player || player.role !== "player") {
        return;
      }

      const raceManager = this.races.get(raceId);
      if (!raceManager || raceManager.state !== "running") {
        return;
      }

      // Use atomic finish operation
      const result = await redisService.finishPlayer(
        raceId,
        playerId,
        data.time_ms
      );

      if (!result.success) {
        logger.warn(`Player ${playerId} already finished race ${raceId}`);
        return;
      }

      // Log finish event
      await redisService.logEvent(raceId, "finish", {
        player: playerId,
        place: result.position,
        time_ms: data.time_ms,
        errors: data.errors,
      });

      // Calculate WPM (assuming average word length of 5)
      const raceData = await redisService.getRace(raceId);
      const textData = await redisService.getText(raceData!.text_id);
      const textLength = parseInt(textData!.length);
      const wpm = Math.round(textLength / 5 / (data.time_ms / 60000));

      // Broadcast finish to all players
      const broadcastPayload: FinishedBroadcastPayload = {
        u: playerId,
        place: result.position,
        time_ms: data.time_ms,
        wpm,
      };

      await this.broadcastToRace(raceId, {
        t: "fb",
        r: raceId,
        d: broadcastPayload,
        ts: Date.now(),
      });

      // Check if race should end
      await this.checkRaceCompletion(raceId);

      logger.info(
        `Player ${playerId} finished race ${raceId} in position ${result.position}`
      );
    } catch (error) {
      logger.error(`Error handling finish: ${error}`);
    }
  }

  private async validateSequence(
    sessionId: string,
    seq: number
  ): Promise<boolean> {
    try {
      const session = await redisService.getSession(sessionId);
      if (!session) return false;

      const lastSeq = parseInt(session.last_seq);
      if (seq <= lastSeq) {
        return false; // Duplicate or out-of-order message
      }

      // Update sequence number
      await redisService.updateSessionSeq(sessionId, seq);
      return true;
    } catch {
      return false;
    }
  }

  private async broadcastRaceState(raceId: string): Promise<void> {
    const raceData = await redisService.getRace(raceId);
    if (!raceData) return;

    const players = await redisService.getRacePlayers(raceId);
    const playerInfos = [];

    for (const playerId of players) {
      const player = this.players.get(playerId);
      if (player) {
        const progress = await redisService.getProgress(raceId, playerId);
        const playerInfo: any = {
          u: playerId,
          name: player.name,
        };
        if (progress) {
          playerInfo.progress = progress;
        }
        playerInfos.push(playerInfo);
      }
    }
    const statePayload: StateBroadcastPayload = {
      state: raceData.state as RaceState,
      countdown_ms: parseInt(raceData.countdown_ms),
      duration_ms: parseInt(raceData.duration_ms),
      players: playerInfos,
    };

    if (raceData.start_ts && raceData.start_ts !== "0") {
      statePayload.start_ts = parseInt(raceData.start_ts);
    }

    await this.broadcastToRace(raceId, {
      t: "st",
      r: raceId,
      d: statePayload,
      ts: Date.now(),
    });
  }

  private async sendRaceStateToPlayer(
    playerId: string,
    raceId: string
  ): Promise<void> {
    const player = this.players.get(playerId);
    if (!player) return;

    const raceData = await redisService.getRace(raceId);
    if (!raceData) return;

    const allProgress = await redisService.getAllProgress(raceId);
    const players = await redisService.getRacePlayers(raceId);

    const playerInfos = players.map((pid) => {
      const p = this.players.get(pid);
      const playerInfo: any = {
        u: pid,
        name: p?.name || "Unknown",
      };
      const progress = allProgress.get(pid);
      if (progress) {
        playerInfo.progress = progress;
      }
      return playerInfo;
    });

    const statePayload: StateBroadcastPayload = {
      state: raceData.state as RaceState,
      countdown_ms: parseInt(raceData.countdown_ms),
      duration_ms: parseInt(raceData.duration_ms),
      players: playerInfos,
    };

    if (raceData.start_ts && raceData.start_ts !== "0") {
      statePayload.start_ts = parseInt(raceData.start_ts);
    }

    this.sendMessage(player.ws, {
      t: "st",
      r: raceId,
      d: statePayload,
      ts: Date.now(),
    });
  }

  private async broadcastAggregatedProgress(): Promise<void> {
    for (const [raceId, raceManager] of this.races.entries()) {
      if (
        raceManager.state !== "running" ||
        raceManager.progressBuffer.size === 0
      ) {
        continue;
      }

      const now = Date.now();
      if (
        now - raceManager.lastProgressBroadcast <
        CONFIG.PROGRESS_BROADCAST_INTERVAL_MS
      ) {
        continue;
      }

      // Broadcast all buffered progress
      for (const [playerId, progress] of raceManager.progressBuffer.entries()) {
        const broadcastPayload: ProgressBroadcastPayload = {
          u: playerId,
          idx: progress.idx,
          chars: progress.chars,
          errors: progress.errors,
          elapsed_ms: progress.elapsed_ms,
        };

        await this.broadcastToRace(raceId, {
          t: "pb",
          r: raceId,
          d: broadcastPayload,
          ts: now,
        });
      }

      raceManager.progressBuffer.clear();
      raceManager.lastProgressBroadcast = now;
    }
  }

  private async checkRaceCompletion(raceId: string): Promise<void> {
    const raceData = await redisService.getRace(raceId);
    if (!raceData || raceData.state !== "running") return;

    const totalPlayers = await redisService.getPlayersCount(raceId);
    const finishedPlayers = await redisService.getFinishOrder(raceId);

    // Check if all players finished
    if (finishedPlayers.length >= totalPlayers) {
      await this.endRace(raceId);
      return;
    }

    // Check if time expired
    const startTs = parseInt(raceData.start_ts);
    const durationMs = parseInt(raceData.duration_ms);
    const now = Date.now();

    if (now >= startTs + durationMs) {
      await this.endRace(raceId);
    }
  }

  private async endRace(raceId: string): Promise<void> {
    await redisService.updateRaceState(raceId, "finished");
    await redisService.logEvent(raceId, "race_finished", { ts: Date.now() });

    const raceManager = this.races.get(raceId);
    if (raceManager) {
      raceManager.state = "finished";

      // Clear timers
      if (raceManager.countdownTimer) {
        clearTimeout(raceManager.countdownTimer);
      }
      if (raceManager.raceTimer) {
        clearTimeout(raceManager.raceTimer);
      }
    }

    // Broadcast final state
    await this.broadcastFinalResults(raceId);

    logger.info(`Race ${raceId} finished`);
  }

  private async broadcastFinalResults(raceId: string): Promise<void> {
    const results = await redisService.getResults(raceId);
    const raceData = await redisService.getRace(raceId);
    const textData = await redisService.getText(raceData!.text_id);
    const textLength = parseInt(textData!.length);

    const finalResults = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result) {
        const player = this.players.get(result.playerId);
        const wpm = Math.round(textLength / 5 / (result.timeMs / 60000));

        finalResults.push({
          u: result.playerId,
          name: player?.name || "Unknown",
          place: i + 1,
          time_ms: result.timeMs,
          wpm,
        });
      }
    }

    const statePayload: StateBroadcastPayload = {
      state: "finished",
      results: finalResults,
    };

    await this.broadcastToRace(raceId, {
      t: "st",
      r: raceId,
      d: statePayload,
      ts: Date.now(),
    });
  }

  private sendHeartbeats(): void {
    const heartbeat: WSMessage = { t: "h", ts: Date.now() };

    for (const player of this.players.values()) {
      try {
        if (player.ws.readyState === WebSocket.OPEN) {
          this.sendMessage(player.ws, heartbeat);
        }
      } catch (error) {
        logger.error(
          `Error sending heartbeat to player ${player.id}: ${error}`
        );
      }
    }
  }

  private async broadcastToRace(
    raceId: string,
    message: WSMessage
  ): Promise<void> {
    const raceManager = this.races.get(raceId);
    if (!raceManager) return;

    const messageStr = JSON.stringify(message);

    for (const player of raceManager.players.values()) {
      try {
        if (player.ws.readyState === WebSocket.OPEN) {
          player.ws.send(messageStr);
        }
      } catch (error) {
        logger.error(`Error broadcasting to player ${player.id}: ${error}`);
      }
    }
  }

  private sendMessage(ws: WebSocket, message: WSMessage): void {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      logger.error(`Error sending message: ${error}`);
    }
  }

  private sendError(
    ws: WebSocket,
    code: string,
    message: string,
    msgId?: string
  ): void {
    const errorPayload: ErrorPayload = { code, message };
    const errorMessage: WSMessage = {
      t: "e",
      d: errorPayload,
      ts: Date.now(),
    };
    if (msgId) errorMessage.i = msgId;
    this.sendMessage(ws, errorMessage);
  }

  private handleDisconnection(sessionId: string): void {
    const playerId = this.sessionToPlayer.get(sessionId);
    if (playerId) {
      const player = this.players.get(playerId);
      if (player) {
        logger.info(
          `Player ${playerId} disconnected from race ${player.raceId}`
        );

        // Remove from race manager
        const raceManager = this.races.get(player.raceId!);
        if (raceManager) {
          raceManager.players.delete(playerId);
        }
      }

      this.players.delete(playerId);
    }

    this.sessionToPlayer.delete(sessionId);

    // Clean up session in Redis
    redisService.deleteSession(sessionId).catch((error) => {
      logger.error(`Error cleaning up session ${sessionId}: ${error}`);
    });
  }

  // Public methods for race management
  async startRace(raceId: string, hostId: string): Promise<boolean> {
    try {
      const raceData = await redisService.getRace(raceId);
      if (!raceData || raceData.state !== "waiting") {
        return false;
      }

      const playersCount = await redisService.getPlayersCount(raceId);
      if (playersCount === 0) {
        return false;
      }

      // Start countdown
      const countdownMs = parseInt(raceData.countdown_ms);
      const startTs = Date.now() + countdownMs;

      await redisService.updateRaceState(raceId, "starting-countdown", startTs);
      await redisService.logEvent(raceId, "start_countdown", {
        by: hostId,
        start_ts: startTs,
        countdown_ms: countdownMs,
      });

      const raceManager = this.races.get(raceId);
      if (raceManager) {
        raceManager.state = "starting-countdown";

        // Set countdown timer
        raceManager.countdownTimer = setTimeout(async () => {
          await this.beginRace(raceId);
        }, countdownMs);
      }

      // Broadcast countdown start
      await this.broadcastRaceState(raceId);

      logger.info(`Race ${raceId} countdown started by ${hostId}`);
      return true;
    } catch (error) {
      logger.error(`Error starting race ${raceId}: ${error}`);
      return false;
    }
  }

  private async beginRace(raceId: string): Promise<void> {
    const actualStartTs = Date.now();
    await redisService.updateRaceState(raceId, "running", actualStartTs);
    await redisService.logEvent(raceId, "race_started", {
      start_ts: actualStartTs,
    });

    const raceManager = this.races.get(raceId);
    if (raceManager) {
      raceManager.state = "running";

      // Set race duration timer
      const raceData = await redisService.getRace(raceId);
      if (raceData) {
        const durationMs = parseInt(raceData.duration_ms);
        raceManager.raceTimer = setTimeout(async () => {
          await this.endRace(raceId);
        }, durationMs);
      }
    }

    // Broadcast race start
    await this.broadcastRaceState(raceId);

    logger.info(`Race ${raceId} started`);
  }

  getRaceManager(raceId: string): RaceManager | undefined {
    return this.races.get(raceId);
  }

  getConnectedPlayersCount(): number {
    return this.players.size;
  }

  getActiveRacesCount(): number {
    return this.races.size;
  }
}

export default WebSocketHandler;

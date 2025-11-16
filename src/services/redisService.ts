import { createClient } from "redis";
import type { RedisClientType } from "redis";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import logger from "../utils/logger.js";
import type {
  RaceData,
  PlayerData,
  SessionData,
  TextData,
  ProgressPayload,
} from "../types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class RedisService {
  private client: RedisClientType;
  private finishScriptSha: string | null = null;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
    });

    this.client.on("error", (err) => {
      logger.error("Redis Client Error", err);
    });

    this.client.on("connect", () => {
      logger.info("Connected to Redis");
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
    await this.loadLuaScripts();
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }

  private async loadLuaScripts(): Promise<void> {
    try {
      const finishScript = readFileSync(
        join(__dirname, "../../scripts/lua/finish.lua"),
        "utf-8"
      );
      this.finishScriptSha = await this.client.scriptLoad(finishScript);
      logger.info("Lua scripts loaded successfully");
    } catch (error) {
      logger.error("Failed to load Lua scripts: " + String(error));
      throw error;
    }
  }

  // Race operations
  async createRace(raceData: RaceData): Promise<void> {
    const key = `race:{${raceData.id}}`;
    await this.client.hSet(key, raceData as any);
    await this.client.expire(key, 24 * 60 * 60); // 24 hours TTL
  }

  async getRace(raceId: string): Promise<RaceData | null> {
    const key = `race:{${raceId}}`;
    const data = await this.client.hGetAll(key);
    return Object.keys(data).length > 0 ? (data as any) : null;
  }

  async updateRaceState(
    raceId: string,
    state: string,
    startTs?: number
  ): Promise<void> {
    const key = `race:{${raceId}}`;
    const updates: any = { state };
    if (startTs !== undefined) {
      updates.start_ts = startTs.toString();
    }
    await this.client.hSet(key, updates);
  }

  async addPlayerToRace(
    raceId: string,
    playerId: string,
    joinTs: number
  ): Promise<number> {
    const key = `race:{${raceId}}:players`;
    return await this.client.zAdd(key, { value: playerId, score: joinTs });
  }

  async getRacePlayers(raceId: string): Promise<string[]> {
    const key = `race:{${raceId}}:players`;
    return await this.client.zRange(key, 0, -1);
  }

  async getPlayersCount(raceId: string): Promise<number> {
    const key = `race:{${raceId}}:players`;
    return await this.client.zCard(key);
  }

  // Progress operations
  async updateProgress(
    raceId: string,
    playerId: string,
    progress: ProgressPayload
  ): Promise<void> {
    const key = `race:{${raceId}}:progress`;
    const progressStr = `${progress.idx},${progress.errors},${progress.elapsed_ms}`;
    await this.client.hSet(key, playerId, progressStr);
  }

  async getProgress(
    raceId: string,
    playerId: string
  ): Promise<ProgressPayload | null> {
    const key = `race:{${raceId}}:progress`;
    const progressStr = await this.client.hGet(key, playerId);
    if (!progressStr) return null;

    const parts = progressStr.split(",").map(Number);
    const [idx = 0, errors = 0, elapsed_ms = 0] = parts;
    return { idx, chars: idx, errors, elapsed_ms };
  }

  async getAllProgress(raceId: string): Promise<Map<string, ProgressPayload>> {
    const key = `race:{${raceId}}:progress`;
    const progressData = await this.client.hGetAll(key);
    const result = new Map<string, ProgressPayload>();

    for (const [playerId, progressStr] of Object.entries(progressData)) {
      const parts = progressStr.split(",").map(Number);
      const [idx = 0, errors = 0, elapsed_ms = 0] = parts;
      result.set(playerId, { idx, chars: idx, errors, elapsed_ms });
    }

    return result;
  }

  // Finish operations (using Lua script)
  async finishPlayer(
    raceId: string,
    playerId: string,
    finishTimeMs: number
  ): Promise<{ success: boolean; position: number }> {
    if (!this.finishScriptSha) {
      throw new Error("Finish script not loaded");
    }

    try {
      const result = (await this.client.evalSha(this.finishScriptSha, {
        keys: [],
        arguments: [raceId, playerId, finishTimeMs.toString()],
      })) as [number, number];

      return {
        success: result[0] === 1,
        position: result[1],
      };
    } catch (error) {
      logger.error("Error executing finish script: " + String(error));
      throw error;
    }
  }

  async getFinishOrder(raceId: string): Promise<string[]> {
    const key = `race:{${raceId}}:order`;
    return await this.client.lRange(key, 0, -1);
  }

  async getResults(
    raceId: string
  ): Promise<Array<{ playerId: string; timeMs: number }>> {
    const key = `race:{${raceId}}:results`;
    const results = await this.client.zRangeWithScores(key, 0, -1);
    return results.map(({ value, score }) => ({
      playerId: value,
      timeMs: score,
    }));
  }

  // Session operations
  async createSession(
    sessionId: string,
    sessionData: SessionData
  ): Promise<void> {
    const key = `session:{${sessionId}}`;
    await this.client.hSet(key, sessionData as any);
    await this.client.expire(key, 60 * 60); // 1 hour TTL
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    const key = `session:{${sessionId}}`;
    const data = await this.client.hGetAll(key);
    return Object.keys(data).length > 0 ? (data as any) : null;
  }

  async updateSessionSeq(sessionId: string, seq: number): Promise<void> {
    const key = `session:{${sessionId}}`;
    await this.client.hSet(key, {
      last_seq: seq.toString(),
      last_seen: Date.now().toString(),
    });
    await this.client.expire(key, 60 * 60); // Refresh TTL
  }

  async deleteSession(sessionId: string): Promise<void> {
    const key = `session:{${sessionId}}`;
    await this.client.del(key);
  }

  // Player operations
  async createPlayer(playerData: PlayerData): Promise<void> {
    const key = `player:{${playerData.id}}`;
    await this.client.hSet(key, playerData as any);
  }

  async getPlayer(playerId: string): Promise<PlayerData | null> {
    const key = `player:{${playerId}}`;
    const data = await this.client.hGetAll(key);
    return Object.keys(data).length > 0 ? (data as any) : null;
  }

  // Text operations
  async createText(textData: TextData): Promise<void> {
    const key = `text:{${textData.id}}`;
    await this.client.hSet(key, textData as any);
  }

  async getText(textId: string): Promise<TextData | null> {
    const key = `text:{${textId}}`;
    const data = await this.client.hGetAll(key);
    return Object.keys(data).length > 0 ? (data as any) : null;
  }

  // Event logging
  async logEvent(
    raceId: string,
    eventType: string,
    eventData: Record<string, any>
  ): Promise<void> {
    const key = `events:race:{${raceId}}`;
    const event = {
      type: eventType,
      ts: Date.now().toString(),
      ...eventData,
    };
    await this.client.xAdd(key, "*", event as any);
  }

  async getEvents(raceId: string, count: number = 100): Promise<any[]> {
    const key = `events:race:{${raceId}}`;
    return await this.client.xRange(key, "-", "+", { COUNT: count });
  }

  // Pub/Sub for race channels
  async publishToRace(raceId: string, message: string): Promise<void> {
    const channel = `race:{${raceId}}:channel`;
    await this.client.publish(channel, message);
  }

  // Cleanup operations
  async cleanupRace(raceId: string): Promise<void> {
    const keys = [
      `race:{${raceId}}`,
      `race:{${raceId}}:players`,
      `race:{${raceId}}:order`,
      `race:{${raceId}}:results`,
      `race:{${raceId}}:progress`,
      `race:{${raceId}}:finished`,
      `events:race:{${raceId}}`,
    ];

    await this.client.del(keys);
  }

  // Health check
  async ping(): Promise<string> {
    return await this.client.ping();
  }
}

const redisService = new RedisService();

export default redisService;

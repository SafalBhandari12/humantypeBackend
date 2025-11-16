import redis from "../config/redisClient.js";
import logger from "../utils/logger.js";

const SAMPLE_TEXT: Record<string, string> = {
  "sample-text":
    "The quick brown fox jumps over the lazy dog. This is a simple typing test to measure your speed and accuracy.",
};

export interface Race {
  id: string;
  textId: string;
  maxPlayers: number;
  state: "waiting" | "countdown" | "running" | "finished";
  createdAt: number;
  startedAt?: number | undefined;
  finishedAt?: number | undefined;
  countdownStarted?: number | undefined;
}

export interface Player {
  id: string;
  name: string;
  progress: number;
  wpm: number;
  accuracy: number;
  isReady: boolean;
  isFinished: boolean;
  finishTime?: number;
  ws?: any;
}

export class RaceManager {
  async createRace(
    raceId: string,
    textId: string,
    maxPlayers: number
  ): Promise<Race> {
    const race: Race = {
      id: raceId,
      textId,
      maxPlayers,
      state: "waiting",
      createdAt: Date.now(),
    };
    await redis.hSet(`race:${raceId}`, {
      id: race.id,
      textId,
      maxPlayers: maxPlayers.toString(),
      state: race.state,
      createdAt: race.createdAt.toString(),
    });

    await redis.expire(`race:${raceId}`, 3600);

    logger.info(`Race ${raceId} created with textId ${textId}`);
    return race;
  }
  async getRace(raceId: string): Promise<Race | null> {
    const raceData = await redis.hGetAll(`race:${raceId}`);
    if (Object.keys(raceData).length === 0) {
      return null;
    }

    const race: Race = {
      id: raceData.id!,
      textId: raceData!.textId!,
      maxPlayers: parseInt(raceData!.maxPlayers!),
      state: raceData.state as Race["state"],
      createdAt: parseInt(raceData!.createdAt!),
      startedAt: raceData.startedAt ? parseInt(raceData.startedAt) : undefined,
      finishedAt: raceData.finishedAt
        ? parseInt(raceData.finishedAt)
        : undefined,
    };
    return race;
  }
}

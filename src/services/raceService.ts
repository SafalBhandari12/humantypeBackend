import WebSocketHandler from "./websocketHandler.js";
import redisService from "./redisService.js";
import logger from "../utils/logger.js";

class RaceService {
  private wsHandler: WebSocketHandler;

  constructor(wsHandler: WebSocketHandler) {
    this.wsHandler = wsHandler;
  }

  async startRace(
    raceId: string,
    hostId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const raceData = await redisService.getRace(raceId);

      if (!raceData) {
        return { success: false, message: "Race not found" };
      }

      if (raceData.state !== "waiting") {
        return {
          success: false,
          message: `Race is already in ${raceData.state} state`,
        };
      }

      const playersCount = await redisService.getPlayersCount(raceId);
      if (playersCount === 0) {
        return { success: false, message: "No players in race" };
      }

      const success = await this.wsHandler.startRace(raceId, hostId);

      if (success) {
        return { success: true, message: "Race countdown started" };
      } else {
        return { success: false, message: "Failed to start race" };
      }
    } catch (error) {
      logger.error(`Error starting race ${raceId}: ${error}`);
      return { success: false, message: "Internal server error" };
    }
  }

  async getRaceStatus(raceId: string): Promise<any> {
    try {
      const raceData = await redisService.getRace(raceId);
      if (!raceData) {
        return null;
      }

      const playersCount = await redisService.getPlayersCount(raceId);
      const raceManager = this.wsHandler.getRaceManager(raceId);

      const connectedPlayers = raceManager ? raceManager.players.size : 0;

      return {
        id: raceData.id,
        state: raceData.state,
        players_count: playersCount,
        connected_players: connectedPlayers,
        start_ts: parseInt(raceData.start_ts) || null,
        duration_ms: parseInt(raceData.duration_ms),
        countdown_ms: parseInt(raceData.countdown_ms),
        max_players: parseInt(raceData.max_players),
        text_id: raceData.text_id,
      };
    } catch (error) {
      logger.error(`Error getting race status ${raceId}: ${error}`);
      return null;
    }
  }

  async getServerStats(): Promise<any> {
    try {
      const connectedPlayers = this.wsHandler.getConnectedPlayersCount();
      const activeRaces = this.wsHandler.getActiveRacesCount();

      // Redis health check
      const redisStatus = await redisService.ping();

      return {
        connected_players: connectedPlayers,
        active_races: activeRaces,
        redis_status: redisStatus === "PONG" ? "healthy" : "unhealthy",
        uptime: process.uptime(),
        memory_usage: process.memoryUsage(),
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error(`Error getting server stats: ${error}`);
      return {
        connected_players: 0,
        active_races: 0,
        redis_status: "error",
        uptime: process.uptime(),
        memory_usage: process.memoryUsage(),
        timestamp: Date.now(),
      };
    }
  }

  async cleanupRace(raceId: string): Promise<boolean> {
    try {
      await redisService.cleanupRace(raceId);
      logger.info(`Cleaned up race ${raceId}`);
      return true;
    } catch (error) {
      logger.error(`Error cleaning up race ${raceId}: ${error}`);
      return false;
    }
  }

  async archiveOldRaces(
    olderThanMs: number = 24 * 60 * 60 * 1000
  ): Promise<number> {
    try {
      // This is a simplified implementation
      // In production, you'd want to scan for races and check their timestamps
      let archivedCount = 0;

      // Implementation would go here to find and archive old races

      logger.info(`Archived ${archivedCount} old races`);
      return archivedCount;
    } catch (error) {
      logger.error(`Error archiving old races: ${error}`);
      return 0;
    }
  }
}

export default RaceService;

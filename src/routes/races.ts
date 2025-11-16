import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import redisService from "../services/redisService.js";
import type {
  CreateRaceRequest,
  CreateRaceResponse,
  RaceMetadataResponse,
  RaceState,
} from "../types/index.js";
import { CONFIG } from "../types/index.js";
import logger from "../utils/logger.js";

const router = Router();

// POST /races - Create a new race
router.post("/races", async (req, res) => {
  try {
    const {
      text_id,
      max_players = CONFIG.MAX_PLAYERS,
      duration_ms = CONFIG.DEFAULT_DURATION_MS,
      countdown_ms = CONFIG.COUNTDOWN_MS,
    } = req.body as CreateRaceRequest;

    if (!text_id) {
      return res.status(400).json({ error: "text_id is required" });
    }

    // Verify text exists
    const textData = await redisService.getText(text_id);
    if (!textData) {
      return res.status(404).json({ error: "Text not found" });
    }

    const raceId = uuidv4();
    const now = new Date().toISOString();

    const raceData = {
      id: raceId,
      text_id,
      state: "waiting" as RaceState,
      created_at: now,
      start_ts: "0",
      duration_ms: duration_ms.toString(),
      countdown_ms: countdown_ms.toString(),
      max_players: max_players.toString(),
    };

    await redisService.createRace(raceData);
    await redisService.logEvent(raceId, "race_created", {
      text_id,
      max_players,
      duration_ms,
      countdown_ms,
      ts: Date.now(),
    });

    const response: CreateRaceResponse = {
      raceId,
      metadata: raceData,
    };

    logger.info(`Race created: ${raceId}`);
    res.status(201).json(response);
  } catch (error) {
    logger.error("Error creating race: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /races/:raceId - Get race metadata
router.get("/races/:raceId", async (req, res) => {
  try {
    const { raceId } = req.params;

    const raceData = await redisService.getRace(raceId);
    if (!raceData) {
      return res.status(404).json({ error: "Race not found" });
    }

    const playersCount = await redisService.getPlayersCount(raceId);

    const response: RaceMetadataResponse = {
      id: raceData.id,
      state: raceData.state as any,
      players_count: playersCount,
      start_ts: parseInt(raceData.start_ts),
      text_id: raceData.text_id,
      duration_ms: parseInt(raceData.duration_ms),
      countdown_ms: parseInt(raceData.countdown_ms),
      max_players: parseInt(raceData.max_players),
    };

    res.json(response);
  } catch (error) {
    logger.error("Error getting race: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /races/:raceId/join - Issue join token (optional endpoint)
router.post("/races/:raceId/join", async (req, res) => {
  try {
    const { raceId } = req.params;
    const { player_id, player_name } = req.body;

    if (!player_id || !player_name) {
      return res
        .status(400)
        .json({ error: "player_id and player_name are required" });
    }

    const raceData = await redisService.getRace(raceId);
    if (!raceData) {
      return res.status(404).json({ error: "Race not found" });
    }

    if (raceData.state === "finished" || raceData.state === "archived") {
      return res.status(400).json({ error: "Race has ended" });
    }

    const playersCount = await redisService.getPlayersCount(raceId);
    if (
      raceData.state === "waiting" &&
      playersCount >= parseInt(raceData.max_players)
    ) {
      return res.status(400).json({ error: "Race is full" });
    }

    // Generate join token (simple JWT-like token for demo)
    const token = Buffer.from(
      JSON.stringify({
        raceId,
        playerId: player_id,
        playerName: player_name,
        issued: Date.now(),
        expires: Date.now() + 5 * 60 * 1000, // 5 minutes
      })
    ).toString("base64");

    res.json({
      token,
      race_id: raceId,
      expires_in: 300, // seconds
    });
  } catch (error) {
    logger.error("Error issuing join token: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /races/:raceId/results - Get race results
router.get("/races/:raceId/results", async (req, res) => {
  try {
    const { raceId } = req.params;

    const raceData = await redisService.getRace(raceId);
    if (!raceData) {
      return res.status(404).json({ error: "Race not found" });
    }

    const results = await redisService.getResults(raceId);
    const finishOrder = await redisService.getFinishOrder(raceId);

    // Get text data for WPM calculation
    const textData = await redisService.getText(raceData.text_id);
    const textLength = textData ? parseInt(textData.length) : 0;

    const formattedResults = results.map((result, index) => {
      const wpm =
        textLength > 0
          ? Math.round(textLength / 5 / (result.timeMs / 60000))
          : 0;
      return {
        player_id: result.playerId,
        place: index + 1,
        time_ms: result.timeMs,
        wpm,
      };
    });

    res.json({
      race_id: raceId,
      state: raceData.state,
      results: formattedResults,
      total_players: await redisService.getPlayersCount(raceId),
      finished_players: finishOrder.length,
    });
  } catch (error) {
    logger.error("Error getting race results: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /races/:raceId/events - Get race events (for debugging/replay)
router.get("/races/:raceId/events", async (req, res) => {
  try {
    const { raceId } = req.params;
    const count = parseInt(req.query.count as string) || 100;

    const raceData = await redisService.getRace(raceId);
    if (!raceData) {
      return res.status(404).json({ error: "Race not found" });
    }

    const events = await redisService.getEvents(raceId, count);

    res.json({
      race_id: raceId,
      events: events.map((event) => ({
        id: event.id,
        timestamp: parseInt(event.message.ts),
        type: event.message.type,
        data: event.message,
      })),
    });
  } catch (error) {
    logger.error("Error getting race events: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

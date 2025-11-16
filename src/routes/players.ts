import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import redisService from "../services/redisService.js";
import logger from "../utils/logger.js";

const router = Router();

// GET /players/:playerId - Get player profile
router.get("/players/:playerId", async (req, res) => {
  try {
    const { playerId } = req.params;

    const playerData = await redisService.getPlayer(playerId);
    if (!playerData) {
      return res.status(404).json({ error: "Player not found" });
    }

    res.json({
      id: playerData.id,
      name: playerData.name,
      rating: parseInt(playerData.rating),
      created_at: playerData.created_at,
      games_played: parseInt(playerData.games_played),
      best_wpm: parseInt(playerData.best_wpm),
    });
  } catch (error) {
    logger.error("Error getting player: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /players - Create a new player
router.post("/players", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: "Player name is required" });
    }

    if (name.length > 50) {
      return res.status(400).json({ error: "Player name too long" });
    }

    const playerId = uuidv4();
    const now = new Date().toISOString();

    const playerData = {
      id: playerId,
      name: name.trim(),
      rating: "1200", // Default rating
      created_at: now,
      games_played: "0",
      best_wpm: "0",
    };

    await redisService.createPlayer(playerData);

    logger.info(`Player created: ${playerId} (${name})`);
    res.status(201).json({
      id: playerId,
      name: playerData.name,
      rating: 1200,
      created_at: now,
      games_played: 0,
      best_wpm: 0,
    });
  } catch (error) {
    logger.error("Error creating player: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /players/:playerId - Update player profile
router.put("/players/:playerId", async (req, res) => {
  try {
    const { playerId } = req.params;
    const { name, rating, best_wpm } = req.body;

    const existingPlayer = await redisService.getPlayer(playerId);
    if (!existingPlayer) {
      return res.status(404).json({ error: "Player not found" });
    }

    const updatedData = { ...existingPlayer };

    if (name !== undefined) {
      if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: "Player name cannot be empty" });
      }
      if (name.length > 50) {
        return res.status(400).json({ error: "Player name too long" });
      }
      updatedData.name = name.trim();
    }

    if (rating !== undefined) {
      if (typeof rating !== "number" || rating < 0) {
        return res.status(400).json({ error: "Invalid rating" });
      }
      updatedData.rating = rating.toString();
    }

    if (best_wpm !== undefined) {
      if (typeof best_wpm !== "number" || best_wpm < 0) {
        return res.status(400).json({ error: "Invalid WPM" });
      }
      updatedData.best_wpm = best_wpm.toString();
    }

    await redisService.createPlayer(updatedData); // This will overwrite

    res.json({
      id: updatedData.id,
      name: updatedData.name,
      rating: parseInt(updatedData.rating),
      created_at: updatedData.created_at,
      games_played: parseInt(updatedData.games_played),
      best_wpm: parseInt(updatedData.best_wpm),
    });
  } catch (error) {
    logger.error("Error updating player: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

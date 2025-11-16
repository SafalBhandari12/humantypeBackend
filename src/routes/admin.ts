import { Router } from "express";
import RaceService from "../services/raceService.js";
import logger from "../utils/logger.js";

const router = Router();

// This would typically be protected by authentication middleware
// For demo purposes, we're skipping auth

// POST /admin/races/:raceId/start - Force start a race
router.post("/admin/races/:raceId/start", async (req, res) => {
  try {
    const { raceId } = req.params;
    const { host_id = "admin" } = req.body;

    const raceService = req.app.get("raceService") as RaceService;
    const result = await raceService.startRace(raceId, host_id);

    if (result.success) {
      res.json({ message: result.message });
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (error) {
    logger.error("Error in admin start race: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/races/:raceId/status - Get detailed race status
router.get("/admin/races/:raceId/status", async (req, res) => {
  try {
    const { raceId } = req.params;

    const raceService = req.app.get("raceService") as RaceService;
    const status = await raceService.getRaceStatus(raceId);

    if (!status) {
      return res.status(404).json({ error: "Race not found" });
    }

    res.json(status);
  } catch (error) {
    logger.error("Error getting race status: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /admin/races/:raceId - Clean up a race
router.delete("/admin/races/:raceId", async (req, res) => {
  try {
    const { raceId } = req.params;

    const raceService = req.app.get("raceService") as RaceService;
    const success = await raceService.cleanupRace(raceId);

    if (success) {
      res.json({ message: "Race cleaned up successfully" });
    } else {
      res.status(500).json({ error: "Failed to clean up race" });
    }
  } catch (error) {
    logger.error("Error cleaning up race: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/stats - Get server statistics
router.get("/admin/stats", async (req, res) => {
  try {
    const raceService = req.app.get("raceService") as RaceService;
    const stats = await raceService.getServerStats();

    res.json(stats);
  } catch (error) {
    logger.error("Error getting server stats: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/cleanup - Archive old races
router.post("/admin/cleanup", async (req, res) => {
  try {
    const { older_than_hours = 24 } = req.body;
    const olderThanMs = older_than_hours * 60 * 60 * 1000;

    const raceService = req.app.get("raceService") as RaceService;
    const archivedCount = await raceService.archiveOldRaces(olderThanMs);

    res.json({
      message: `Archived ${archivedCount} old races`,
      archived_count: archivedCount,
    });
  } catch (error) {
    logger.error("Error during cleanup: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

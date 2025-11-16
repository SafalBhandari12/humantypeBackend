import express, { type Request, type Response } from "express";
import logger from "../utils/logger.js";
import { uuid } from "uuidv4";
import { RaceManager } from "../services/RaceManager.js";
import z from "zod";

const raceIdSchema = z.object({
  raceId: z.uuid(),
});

const router = express.Router();

const raceManager = new RaceManager();

router.post("/race/create", async (req: Request, res: Response) => {
  try {
    const { textId = "sample-text", maxPlayers = 4 } = req.body;
    const raceId = uuid();

    const race = await raceManager.createRace(raceId, textId, maxPlayers);
    res.status(201).json({ raceId, race });
  } catch (err) {
    if (err instanceof Error) {
      logger.error("Failed to create race:");
      res.status(500).json({ error: "Failed to create race", err });
    }
  }
});

router.get("/race/:raceId", async (req: Request, res: Response) => {
  try {
    const data = raceIdSchema.safeParse({ raceId: req.params.raceId });
    if (!data.success) {
      return res.status(400).json({ error: "Invalid race ID" });
    }
    const race = await raceManager.getRace(data.data.raceId);
    if (!race) {
      return res.status(404).json({ error: "Race not found" });
    }
    res.status(200).json({ race });
  } catch (err) {
    logger.error("Failed to get race:");
    res.status(500).json({ error: "Failed to get race", err });
  }
});

export default router;

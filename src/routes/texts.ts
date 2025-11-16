import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import redisService from "../services/redisService.js";
import logger from "../utils/logger.js";

const router = Router();

// GET /texts/:textId - Get text data
router.get("/texts/:textId", async (req, res) => {
  try {
    const { textId } = req.params;

    const textData = await redisService.getText(textId);
    if (!textData) {
      return res.status(404).json({ error: "Text not found" });
    }

    res.json({
      id: textData.id,
      text: textData.text,
      length: parseInt(textData.length),
      hash: textData.hash,
      difficulty: textData.difficulty,
      author: textData.author,
    });
  } catch (error) {
    logger.error("Error getting text: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /texts - Create a new text
router.post("/texts", async (req, res) => {
  try {
    const { text, difficulty = "medium", author = "Anonymous" } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Text content is required" });
    }

    if (text.length < 50) {
      return res
        .status(400)
        .json({ error: "Text must be at least 50 characters long" });
    }

    if (text.length > 2000) {
      return res
        .status(400)
        .json({ error: "Text must be less than 2000 characters" });
    }

    const validDifficulties = ["easy", "medium", "hard", "expert"];
    if (!validDifficulties.includes(difficulty)) {
      return res.status(400).json({ error: "Invalid difficulty level" });
    }

    const textId = uuidv4();
    const textHash = createHash("sha256").update(text).digest("hex");

    const textData = {
      id: textId,
      text: text.trim(),
      length: text.trim().length.toString(),
      hash: textHash,
      difficulty,
      author: author.trim(),
    };

    await redisService.createText(textData);

    logger.info(
      `Text created: ${textId} (${text.length} chars, ${difficulty})`
    );
    res.status(201).json({
      id: textId,
      text: textData.text,
      length: parseInt(textData.length),
      hash: textHash,
      difficulty,
      author: textData.author,
    });
  } catch (error) {
    logger.error("Error creating text: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /texts - List texts (with pagination)
router.get("/texts", async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const difficulty = req.query.difficulty as string;

    // This is a simplified implementation
    // In a real app, you'd want proper pagination with Redis SCAN
    const allTexts: any[] = []; // This would come from a proper text listing implementation

    res.json({
      texts: allTexts,
      page,
      limit,
      total: allTexts.length,
      hasMore: false,
    });
  } catch (error) {
    logger.error("Error listing texts: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Sample texts for development
const SAMPLE_TEXTS = [
  {
    id: "sample-1",
    text: "The quick brown fox jumps over the lazy dog. This pangram contains every letter of the alphabet at least once, making it a perfect typing exercise for beginners.",
    difficulty: "easy",
    author: "Traditional",
  },
  {
    id: "sample-2",
    text: "To be or not to be, that is the question: Whether 'tis nobler in the mind to suffer the slings and arrows of outrageous fortune, or to take arms against a sea of troubles and by opposing end them.",
    difficulty: "medium",
    author: "William Shakespeare",
  },
  {
    id: "sample-3",
    text: "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness.",
    difficulty: "hard",
    author: "Charles Dickens",
  },
];

// POST /texts/samples - Initialize sample texts
router.post("/texts/samples", async (req, res) => {
  try {
    const results = [];

    for (const sample of SAMPLE_TEXTS) {
      const textHash = createHash("sha256").update(sample.text).digest("hex");

      const textData = {
        id: sample.id,
        text: sample.text,
        length: sample.text.length.toString(),
        hash: textHash,
        difficulty: sample.difficulty,
        author: sample.author,
      };

      await redisService.createText(textData);
      results.push({
        id: sample.id,
        text: sample.text,
        length: sample.text.length,
        difficulty: sample.difficulty,
        author: sample.author,
      });
    }

    logger.info(`Created ${results.length} sample texts`);
    res.json({
      message: "Sample texts created successfully",
      texts: results,
    });
  } catch (error) {
    logger.error("Error creating sample texts: " + String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

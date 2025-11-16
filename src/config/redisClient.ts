// This file is deprecated - use src/services/redisService.ts instead
// Keeping for backwards compatibility

import { createClient } from "redis";
import logger from "../utils/logger.js";

const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redis.on("error", (err) => {
  logger.error("Redis Client Error: " + String(err));
});

redis.on("connect", () => {
  logger.info("Connected to Redis (legacy client)");
});

// Don't auto-connect here anymore - let the service handle it
// await redis.connect();

export default redis;

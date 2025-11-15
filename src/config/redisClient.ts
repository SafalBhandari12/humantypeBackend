import { createClient } from "redis";
import logger from "../utils/logger.js";

const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redis.on("error", (err) => {
  logger.error("Redis Client Error", err);
});

redis.on("connect", () => {
  logger.info("Connected to Redis");
});

await redis.connect();

await redis.hSet("player:demo", { name: "testUser", wpm: 75, accuracy: 90 });
logger.info("Demo player data set in Redis");

export default redis;

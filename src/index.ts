import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import logger from "./utils/logger.js";
import redis from "./config/redisClient.js";
import router from "./routes/index.js";

dotenv.config();

const app = express();
const server = createServer(app);

app.use(express.json());
app.use("/api", router);

const wss = new WebSocketServer({ server });



wss.on("connection", (ws) => {
  logger.info("New WebSocket connection established");
  ws.on("message", (message) => {
    logger.info(`Received message: ${message}`);
    ws.send(`Echo: ${message}`);
  });
  ws.on("close", () => {
    logger.info("WebSocket connection closed");
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  logger.info(`Server is listening on port ${PORT}`);
});

process.on("SIGINT", async () => {
  logger.info("Shutting down server...");
  await redis.quit();
  server.close(() => {
    logger.info("Server shut down gracefully");
    process.exit(0);
  });
});

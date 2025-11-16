import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import dotenv from "dotenv";
import logger from "./utils/logger.js";
import redisService from "./services/redisService.js";
import WebSocketHandler from "./services/websocketHandler.js";
import RaceService from "./services/raceService.js";

// Import routes
import racesRouter from "./routes/races.js";
import playersRouter from "./routes/players.js";
import textsRouter from "./routes/texts.js";
import adminRouter from "./routes/admin.js";

dotenv.config();

const app = express();
const server = createServer(app);

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Initialize services
const wsHandler = new WebSocketHandler();
const raceService = new RaceService(wsHandler);

// Store services in app for route access
app.set("wsHandler", wsHandler);
app.set("raceService", raceService);

// WebSocket setup
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  wsHandler.handleConnection(ws);
});

// REST API Routes
app.use("/api", racesRouter);
app.use("/api", playersRouter);
app.use("/api", textsRouter);
app.use("/api", adminRouter);

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    const redisStatus = await redisService.ping();
    res.json({
      status: "healthy",
      redis: redisStatus === "PONG" ? "connected" : "disconnected",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (error) {
    res.status(500).json({
      status: "unhealthy",
      redis: "error",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  }
});

// Basic info endpoint
app.get("/", (req, res) => {
  res.json({
    name: "TypeRacer Backend",
    version: "1.0.0",
    description: "Real-time multiplayer typing race server",
    endpoints: {
      websocket: "ws://localhost:" + (process.env.PORT || 3000),
      api: "/api",
      health: "/health",
    },
  });
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Connect to Redis
    await redisService.connect();

    // Start HTTP server
    server.listen(PORT, () => {
      logger.info(`🚀 TypeRacer server running on port ${PORT}`);
      logger.info(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
      logger.info(`🔗 REST API: http://localhost:${PORT}/api`);
      logger.info(`💚 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    logger.error("Failed to start server: " + String(error));
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Shutting down server...");

  try {
    await redisService.disconnect();
    logger.info("Redis connection closed");
  } catch (error) {
    logger.error("Error closing Redis: " + String(error));
  }

  server.close(() => {
    logger.info("Server shut down gracefully");
    process.exit(0);
  });
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully...");

  try {
    await redisService.disconnect();
  } catch (error) {
    logger.error("Error closing Redis on SIGTERM: " + String(error));
  }

  server.close(() => {
    process.exit(0);
  });
});

startServer();

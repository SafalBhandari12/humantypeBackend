# TypeRacer Backend

A real-time multiplayer typing race server built with Node.js, TypeScript, WebSockets, Redis, and Express.

## 🚀 Features

- **Real-time multiplayer racing** - Up to 8 players per race
- **Low-latency WebSocket communication** - Sub-100ms message delivery
- **Anti-cheat protection** - Speed validation and progress monitoring
- **Atomic race operations** - Consistent finish placement using Lua scripts
- **Comprehensive API** - REST endpoints for race management
- **Horizontal scaling ready** - Redis cluster support with hash tags
- **Production monitoring** - Health checks and performance metrics

## 🏗 Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Web Clients   │────▶│  WebSocket API   │────▶│  Race Manager   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                 │                         │
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  REST Clients   │────▶│   Express API    │────▶│ Redis Service   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                           │
                                                 ┌─────────────────┐
                                                 │ Redis Database  │
                                                 │ • Race Data     │
                                                 │ • Player Info   │
                                                 │ • Event Streams │
                                                 └─────────────────┘
```

## 📋 Quick Start

### Prerequisites

- Node.js 18+
- Redis 6+
- npm or yarn

### Installation

1. **Clone the repository**

   ```bash
   git clone <your-repo-url>
   cd typeracer
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start Redis**

   ```bash
   # Option 1: Local Redis
   redis-server

   # Option 2: Docker
   docker run -d -p 6379:6379 --name redis redis:7-alpine

   # Option 3: Full stack with Docker Compose
   docker-compose up -d
   ```

4. **Configure environment**

   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

5. **Start the server**

   ```bash
   # Development mode
   npm run dev

   # Production mode
   npm run build
   npm start
   ```

6. **Initialize sample data**
   ```bash
   curl -X POST http://localhost:3000/api/texts/samples
   ```

## 🎮 Usage

### Create a Race

```bash
curl -X POST http://localhost:3000/api/races \
  -H "Content-Type: application/json" \
  -d '{
    "text_id": "sample-1",
    "max_players": 4,
    "duration_ms": 60000
  }'
```

### Join via WebSocket

```javascript
const ws = new WebSocket("ws://localhost:3000");

// Join a race
ws.send(
  JSON.stringify({
    t: "j", // join message
    r: "race-id", // race ID
    u: "player-id", // player ID
    s: 1, // sequence number
    d: { n: "PlayerName" }, // player name
  })
);

// Send typing progress
ws.send(
  JSON.stringify({
    t: "p", // progress message
    r: "race-id",
    u: "player-id",
    s: 2,
    d: {
      idx: 25, // current character index
      chars: 25, // characters typed
      errors: 2, // error count
      elapsed_ms: 5000, // time elapsed
    },
  })
);
```

## 📊 API Endpoints

### Races

- `POST /api/races` - Create a new race
- `GET /api/races/:id` - Get race information
- `GET /api/races/:id/results` - Get race results

### Players

- `POST /api/players` - Create a player
- `GET /api/players/:id` - Get player profile

### Texts

- `GET /api/texts/:id` - Get typing text
- `POST /api/texts/samples` - Create sample texts

### Admin

- `POST /api/admin/races/:id/start` - Start a race
- `GET /api/admin/stats` - Server statistics
- `GET /api/admin/races/:id/status` - Detailed race status

## 🔧 WebSocket Protocol

### Message Format

```json
{
  "t": "message_type",      // Message type (j, p, f, etc.)
  "i": "msg_id",           // Optional message ID
  "r": "race_id",          // Race ID
  "u": "player_id",        // Player ID
  "s": 123,                // Sequence number
  "d": { ... },            // Message data
  "ts": 1699200000000      // Server timestamp
}
```

### Message Types

| Type | Direction | Description         |
| ---- | --------- | ------------------- |
| `j`  | C→S       | Join race           |
| `ja` | S→C       | Join acknowledgment |
| `p`  | C→S       | Progress update     |
| `pb` | S→C       | Progress broadcast  |
| `f`  | C→S       | Race finished       |
| `fb` | S→C       | Finish broadcast    |
| `st` | S→C       | State broadcast     |
| `h`  | C↔S       | Heartbeat           |
| `e`  | S→C       | Error message       |

## 🗄 Redis Schema

```
race:{id}              -> HASH    # Race metadata
race:{id}:players      -> ZSET    # Player list (sorted by join time)
race:{id}:progress     -> HASH    # Current player progress
race:{id}:order        -> LIST    # Finish order
race:{id}:results      -> ZSET    # Final results (sorted by time)
events:race:{id}       -> STREAM  # Event log for replay
player:{id}            -> HASH    # Player profile
session:{id}           -> HASH    # Session data
text:{id}              -> HASH    # Typing text content
```

## 🔒 Security Features

- **Sequence number validation** prevents message replay attacks
- **Rate limiting** on progress updates (max 20/second)
- **Anti-cheat validation** for impossible typing speeds
- **Session management** with sliding TTL windows
- **Input sanitization** on all API endpoints

## ⚡ Performance

- **Sub-100ms latency** for WebSocket messages
- **Supports 1000+ concurrent connections** per server instance
- **Redis clustering ready** with hash tag distribution
- **Memory-efficient** progress tracking (60% smaller than JSON)
- **Atomic operations** prevent race conditions

## 🐳 Docker Deployment

```bash
# Start full stack
docker-compose up -d

# Scale the application
docker-compose up -d --scale typeracer-backend=3

# View logs
docker-compose logs -f typeracer-backend
```

## 📈 Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

### Server Statistics

```bash
curl http://localhost:3000/api/admin/stats
```

### Redis Monitoring

```bash
redis-cli info stats
```

## 🧪 Testing

See the [Testing Guide](docs/testing-guide.md) for comprehensive testing instructions including:

- API endpoint testing with curl
- WebSocket testing with browser console
- Load testing scenarios
- Debugging tips

## 📚 Documentation

- [System Design](design/typeracer-backend.md) - Detailed architecture and design decisions
- [Testing Guide](docs/testing-guide.md) - Complete testing instructions
- [Week 2 Summary](docs/week-2.md) - Implementation summary and deliverables
- [WebSocket Examples](examples/ws-sample.json) - Sample WebSocket messages
- [Lua Scripts](scripts/lua/) - Redis Lua scripts for atomic operations

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Redis](https://redis.io/) for the blazing-fast data store
- [ws](https://github.com/websockets/ws) for WebSocket implementation
- [Express](https://expressjs.com/) for the REST API framework
- [Pino](https://getpino.io/) for structured logging

---

**Built with ❤️ using TypeScript and Redis**

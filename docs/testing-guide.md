# TypeRacer Backend Test Guide

This document provides comprehensive testing instructions for the TypeRacer backend system.

## Prerequisites

1. **Node.js** (v18+)
2. **Redis** server running locally or via Docker
3. **WebSocket client** (like wscat or browser dev tools)
4. **HTTP client** (like curl, Postman, or Thunder Client)

## Quick Start

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Start Redis:**

   ```bash
   # Option 1: Docker
   docker run -d -p 6379:6379 --name redis redis:7-alpine

   # Option 2: Docker Compose (includes app)
   docker-compose up -d redis
   ```

3. **Start the server:**

   ```bash
   npm run dev
   ```

4. **Verify server is running:**
   ```bash
   curl http://localhost:3000/health
   ```

## API Testing

### 1. Create Sample Texts

First, create some sample texts to use in races:

```bash
curl -X POST http://localhost:3000/api/texts/samples \
  -H "Content-Type: application/json"
```

### 2. Create a Player

```bash
curl -X POST http://localhost:3000/api/players \
  -H "Content-Type: application/json" \
  -d '{"name": "TestPlayer1"}'
```

Save the returned `id` for use in subsequent requests.

### 3. Create a Race

```bash
curl -X POST http://localhost:3000/api/races \
  -H "Content-Type: application/json" \
  -d '{
    "text_id": "sample-1",
    "max_players": 4,
    "duration_ms": 60000,
    "countdown_ms": 3000
  }'
```

Save the returned `raceId` for WebSocket testing.

### 4. Get Race Information

```bash
curl http://localhost:3000/api/races/{raceId}
```

### 5. Get Text Content

```bash
curl http://localhost:3000/api/texts/sample-1
```

## WebSocket Testing

### Using Browser Console

1. Open browser dev tools
2. Go to Console tab
3. Connect to WebSocket:

```javascript
const ws = new WebSocket("ws://localhost:3000");

ws.onopen = () => {
  console.log("Connected to TypeRacer server");
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log("Received:", message);
};

ws.onerror = (error) => {
  console.error("WebSocket error:", error);
};

// Helper function to send messages
function sendMessage(message) {
  ws.send(JSON.stringify(message));
}
```

### Join a Race

```javascript
// Join race as a player
sendMessage({
  t: "j", // join
  i: "msg1", // message id
  r: "your-race-id", // race id from API
  u: "player1", // player id
  s: 1, // sequence number
  d: { n: "TestPlayer1" }, // player name
});
```

### Send Progress Updates

```javascript
// Simulate typing progress
let sequence = 2;
let currentIndex = 0;

function sendProgress() {
  sendMessage({
    t: "p", // progress
    r: "your-race-id",
    u: "player1",
    s: sequence++,
    d: {
      idx: currentIndex++,
      chars: currentIndex,
      errors: 0,
      elapsed_ms: Date.now() - raceStartTime,
    },
  });
}

// Send progress every 200ms
setInterval(sendProgress, 200);
```

### Finish the Race

```javascript
sendMessage({
  t: "f", // finished
  r: "your-race-id",
  u: "player1",
  s: sequence++,
  d: {
    time_ms: 30000, // 30 seconds
    errors: 2,
  },
});
```

### Using wscat (Command Line)

Install wscat:

```bash
npm install -g wscat
```

Connect and test:

```bash
wscat -c ws://localhost:3000

# Send join message
{"t":"j","i":"msg1","r":"race-id","u":"player1","s":1,"d":{"n":"TestPlayer1"}}

# Send progress
{"t":"p","r":"race-id","u":"player1","s":2,"d":{"idx":10,"chars":10,"errors":0,"elapsed_ms":5000}}

# Send finish
{"t":"f","r":"race-id","u":"player1","s":3,"d":{"time_ms":30000,"errors":2}}
```

## Complete Race Flow Test

Here's a complete test scenario:

### 1. Setup

```bash
# Create sample texts
curl -X POST http://localhost:3000/api/texts/samples

# Create two players
curl -X POST http://localhost:3000/api/players -H "Content-Type: application/json" -d '{"name": "Alice"}'
curl -X POST http://localhost:3000/api/players -H "Content-Type: application/json" -d '{"name": "Bob"}'

# Create a race
curl -X POST http://localhost:3000/api/races -H "Content-Type: application/json" -d '{"text_id": "sample-1"}'
```

### 2. WebSocket Connections

Open two browser tabs or terminals with wscat and connect both:

**Player 1 (Alice):**

```javascript
const ws1 = new WebSocket("ws://localhost:3000");
ws1.onmessage = (e) => console.log("Alice:", JSON.parse(e.data));

// Join race
ws1.send(
  JSON.stringify({
    t: "j",
    i: "a1",
    r: "race-id",
    u: "alice-id",
    s: 1,
    d: { n: "Alice" },
  })
);
```

**Player 2 (Bob):**

```javascript
const ws2 = new WebSocket("ws://localhost:3000");
ws2.onmessage = (e) => console.log("Bob:", JSON.parse(e.data));

// Join race
ws2.send(
  JSON.stringify({
    t: "j",
    i: "b1",
    r: "race-id",
    u: "bob-id",
    s: 1,
    d: { n: "Bob" },
  })
);
```

### 3. Start Race

```bash
curl -X POST http://localhost:3000/api/admin/races/{raceId}/start \
  -H "Content-Type: application/json" \
  -d '{"host_id": "alice-id"}'
```

### 4. Race Simulation

Both players should see countdown messages, then race start. Simulate typing:

```javascript
// Alice types faster
let aliceSeq = 2;
setInterval(() => {
  ws1.send(
    JSON.stringify({
      t: "p",
      r: "race-id",
      u: "alice-id",
      s: aliceSeq++,
      d: {
        idx: aliceSeq * 2,
        chars: aliceSeq * 2,
        errors: 0,
        elapsed_ms: aliceSeq * 1000,
      },
    })
  );
}, 1000);

// Bob types slower
let bobSeq = 2;
setInterval(() => {
  ws2.send(
    JSON.stringify({
      t: "p",
      r: "race-id",
      u: "bob-id",
      s: bobSeq++,
      d: { idx: bobSeq, chars: bobSeq, errors: 1, elapsed_ms: bobSeq * 1200 },
    })
  );
}, 1200);
```

## Admin Testing

### Server Stats

```bash
curl http://localhost:3000/api/admin/stats
```

### Race Status

```bash
curl http://localhost:3000/api/admin/races/{raceId}/status
```

### Force Start Race

```bash
curl -X POST http://localhost:3000/api/admin/races/{raceId}/start \
  -H "Content-Type: application/json" \
  -d '{"host_id": "admin"}'
```

### Cleanup Race

```bash
curl -X DELETE http://localhost:3000/api/admin/races/{raceId}
```

## Load Testing

### Simple Load Test with curl

```bash
# Create multiple races
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/races \
    -H "Content-Type: application/json" \
    -d '{"text_id": "sample-1"}' &
done
wait
```

### WebSocket Load Test

For serious load testing, consider using tools like:

- **Artillery.io** for WebSocket load testing
- **WebSocket King** for browser-based testing
- **Custom Node.js scripts** for specific scenarios

Example Artillery config:

```yaml
config:
  target: "ws://localhost:3000"
  phases:
    - duration: 60
      arrivalRate: 10

scenarios:
  - name: "Join and race"
    weight: 100
    engine: ws
```

## Troubleshooting

### Common Issues

1. **Redis Connection Failed**

   ```bash
   # Check if Redis is running
   redis-cli ping

   # Start Redis with Docker
   docker run -d -p 6379:6379 redis:7-alpine
   ```

2. **WebSocket Connection Refused**

   - Ensure server is running on correct port
   - Check firewall settings
   - Verify WebSocket endpoint in client code

3. **Race Not Starting**

   - Check if players have joined
   - Verify race state is "waiting"
   - Use admin endpoint to force start

4. **Progress Not Updating**
   - Check sequence numbers are incrementing
   - Verify race is in "running" state
   - Check for rate limiting

### Debug Logs

Enable detailed logging:

```bash
LOG_LEVEL=debug npm run dev
```

### Redis Debugging

```bash
# Connect to Redis CLI
redis-cli

# List all keys
KEYS *

# Get race data
HGETALL race:{race-id}

# Get players in race
ZRANGE race:{race-id}:players 0 -1 WITHSCORES

# Get race events
XRANGE events:race:{race-id} - +
```

## Performance Testing

### Metrics to Monitor

1. **WebSocket connections**: Number of concurrent connections
2. **Message throughput**: Messages per second
3. **Redis operations**: Commands per second
4. **Memory usage**: Server and Redis memory
5. **Latency**: Message round-trip time

### Monitoring Commands

```bash
# Server stats
curl http://localhost:3000/api/admin/stats

# Redis stats
redis-cli info stats

# Process monitoring
top -p $(pgrep node)
```

## Expected Behavior

### Normal Race Flow

1. Players join → receive join acknowledgment
2. Race starts → countdown messages sent
3. Race begins → progress updates exchanged
4. Players finish → finish broadcasts sent
5. Race ends → final results broadcast

### Message Types You'll See

- `ja`: Join acknowledgment
- `st`: State broadcasts (waiting, countdown, running, finished)
- `pb`: Progress broadcasts from other players
- `fb`: Finish broadcasts when players complete
- `h`: Heartbeat messages
- `e`: Error messages

This completes the comprehensive testing guide for the TypeRacer backend system.

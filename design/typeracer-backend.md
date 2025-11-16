# Typeracer — Backend Deliverables

Below is a single, repo-ready Markdown document containing key Redis key patterns, compact WebSocket schema (join, ack, progress, finished, state), minimal REST surface, lifecycle state machine (waiting → starting-countdown → running → finished → archived), JSON examples, Redis operation examples, and a simple ASCII sequence diagram for join → start → progress → finish.

## Overview

Authoritative server with Redis as primary fast store. Goals: low-latency WS updates, deterministic server-side ordering, replayable event log. Use compact keys (hash tags) for Redis cluster slot affinity: race:{<id>}:....

## Key patterns (compact)

Use hash tags so multi-key atomic ops can target same shard when needed:

```
race:{<id>}                -> HASH    # race metadata: id, text_id, state, start_ts, duration_ms, countdown_ms, max_players
race:{<id>}:players        -> ZSET    # members=playerId, score=join_ts (or join_order)
race:{<id>}:order          -> LIST    # RPUSH playerId as they finish (canonical finish order)
race:{<id>}:results        -> ZSET    # playerId -> finish_time_ms (or wpm)
race:{<id>}:progress      -> HASH    # field=playerId -> compact progress blob (json/string)
events:race:{<id>}         -> STREAM  # XADD append-only event log: join/start/progress/finish
player:{<id>}              -> HASH    # profile: name, rating, created_at
session:{<sid>}            -> HASH    # session -> player, ws_conn_id, last_seen, last_seq
text:{<id>}                -> HASH    # typing text metadata: text, length, hash, difficulty
race:{<id>}:channel        -> string  # optional channel name for pub/sub or ws fanout
```

### Example race:{123} hash

```
HGETALL race:{123}
{
  id: "123",
  text_id: "t:42",
  state: "waiting",        # waiting|starting-countdown|running|finished|archived
  created_at: "2025-11-16T04:00:00Z",
  start_ts: "0",           # epoch ms when race moves to running
  duration_ms: "60000",
  countdown_ms: "3000",
  max_players: "8"
}
```

## Compact WebSocket message schema (wire format)

All WS messages must use a small envelope to reduce bandwidth:

```json
{
  "t": "<type>",      # message type (short code)
  "i": "<msgId?>",    # optional client message id for idempotency
  "r": "<raceId?>",   # race id (when relevant)
  "u": "<playerId?>", # player id (when relevant)
  "s": <seq?>,        # client sequence number (monotonic per session)
  "d": { ... },       # payload / data
  "ts": <server_ts?>  # server ms timestamp (attached by server on broadcast)
}
```

**Fields:**

- t = type (short codes below)
- i = client-supplied id for correlating ack
- r = race id
- u = player id
- s = client sequence number (for de-dup)
- d = typed payload
- ts = server timestamp in ms (server attaches)

### Type codes

- **j** — join (client → server)
- **ja** — join-ack (server → client)
- **p** — progress update (client → server)
- **pb** — progress broadcast (server → clients)
- **f** — finished (client → server)
- **fb** — finished broadcast (server → clients)
- **st** — state broadcast (server → clients) — includes race state and snapshot
- **e** — error
- **h** — heartbeat

## WS examples (JSON)

### 1) Join (client → server)

```json
{ "t": "j", "i": "m1", "r": "123", "u": "u456", "s": 1, "d": { "n": "alice" } }
```

### 1a) Join Ack (server → client)

```json
{ "t":"ja", "i":"m1", "r":"123", "u":"u456", "d":{ "ok": true, "state":"waiting", "players_count":3 }, "ts":169... }
```

### 2) Progress update (client → server)

Sent frequently (rate limited; e.g., 100–1000 ms).

```json
{
  "t": "p",
  "r": "123",
  "u": "u456",
  "s": 42,
  "d": { "idx": 30, "chars": 120, "errors": 3, "elapsed_ms": 12000 }
}
```

### 2a) Progress broadcast (server → clients) — aggregated/throttled

```json
{ "t":"pb", "r":"123", "ts":169..., "d":{ "u":"u456", "idx":30, "chars":120, "errors":3, "elapsed_ms":12000 } }
```

### 3) Finished (client → server)

```json
{
  "t": "f",
  "r": "123",
  "u": "u456",
  "s": 100,
  "d": { "time_ms": 31000, "errors": 4 }
}
```

### 3a) Finished broadcast (server → clients)

```json
{ "t":"fb", "r":"123", "ts":169..., "d":{ "u":"u456", "place":2, "time_ms":31000 } }
```

### 4) State broadcast (server → clients)

Used for waiting, countdown ticks, running, finished snapshots:

```json
{ "t":"st", "r":"123", "ts":169..., "d":{ "state":"starting-countdown", "start_ts":169..., "countdown_ms":3000, "players":[ {"u":"u123","name":"bob"}, {"u":"u456","name":"alice"} ] } }
```

### 5) Heartbeat

Client/Server:

```json
{ "t":"h", "ts":169... }
```

## Minimal REST endpoints

Use REST for lobby and persistent operations; WS for in-race real-time.

```
POST   /races                -> create race. Body: { text_id, max_players?, duration_ms?, countdown_ms? }  => { raceId, metadata }
GET    /races/{raceId}       -> get race metadata (state, players_count, start_ts)
POST   /races/{raceId}/join  -> optional: issue short join token for WS
GET    /texts/{textId}       -> return text payload (for client preload)
GET    /players/{playerId}   -> get player profile
```

**Notes:**

- For most flows, joining via WS (t: 'j') is acceptable; POST /races/{id}/join can be used for non-WS clients or to prefetch tokens.
- Keep REST responses small; do not expose ephemeral event streams via REST.

## Lifecycle state machine

**States:** waiting → starting-countdown → running → finished → archived

### Transitions & side-effects

#### waiting

- Accept joins (ZADD race:{id}:players).
- Broadcast st snapshots periodically or on join.
- When host triggers start OR players_count == max_players → transition to starting-countdown.
- Policy: optionally allow spectator joins during running.

#### starting-countdown

- Disallow new joins (or mark them as spectators).
- Write start_ts = now + countdown_ms into race:{id}.
- Broadcast countdown ticks (st) every second (or more granular).
- At countdown end: set state = running, XADD events:race:{id} start event.

#### running

- Accept p progress messages. Validate idx monotonic progression and sanity checks.
- Persist progress to HSET race:{id}:progress playerId -> compact blob and XADD event.
- When player finishes, server runs atomic finish (Lua) to RPUSH race:{id}:order and ZADD race:{id}:results.
- **Termination conditions:**
  - All participating players finished OR
  - now >= start_ts + duration_ms OR
  - Admin stops race.
- On termination, set state = finished, attach final timestamp, broadcast fb for any pending finishes and a final st.

#### finished

- Freeze progress updates (ignore p or accept for spectating only).
- Publish final leaderboard snapshot in st.
- Schedule archival job to run after retention window (e.g., 24h).
- Keep events:race:{id} for replay/export.

#### archived

- Archival worker exports events:race:{id} to long-term storage and deletes ephemeral Redis keys (or compress to a race_archive:{id} minimal record).
- Optionally keep a small race:summary:{id} for historical queries.

## Suggested timing defaults

- **countdown_ms:** 3000 (3s) — configurable 3–10s.
- **reconnect_grace:** 10000–30000 ms (10–30s).
- **session_ttl sliding:** 60000 ms (60s).
- **race_retention:** 24h–7d depending on analytics needs.

## Atomic finish (Lua script concept)

Guarantee a single successful finish recording per player (idempotent):

```lua
-- ARGV[1] = raceId, ARGV[2] = playerId, ARGV[3] = finish_time_ms
local race_prefix = "race:{" .. ARGV[1] .. "}"
local finished_key = race_prefix .. ":finished"
if redis.call('HEXISTS', finished_key, ARGV[2]) == 0 then
  redis.call('RPUSH', race_prefix .. ":order", ARGV[2])
  redis.call('ZADD', race_prefix .. ":results", ARGV[3], ARGV[2])
  redis.call('HSET', finished_key, ARGV[2], ARGV[3])
  return 1
end
return 0
```

Use EVALSHA or SCRIPT LOAD for production.

## Redis operation examples (join / start / progress / finish)

### Join (atomic via MULTI)

```redis
MULTI
  HSET session:{sid} player_id {playerId} race {raceId} ws_conn {connId} last_seen {ts} last_seq 0
  ZADD race:{raceId}:players {join_ts} {playerId}
  XADD events:race:{raceId} * type join player {playerId} ts {ts}
EXEC
```

Server then broadcasts ja and publishes players update on race:{id}:channel.

### Start (host triggers)

```redis
HSET race:{raceId} state starting-countdown start_ts {future_ms}
XADD events:race:{raceId} * type start by {hostId} start_ts {future_ms} countdown_ms {countdown_ms}
# schedule countdown tick broadcasts on server side (no blocking in Redis)
```

When countdown ends:

```redis
HSET race:{raceId} state running start_ts {now_ms}
XADD events:race:{raceId} * type running start_ts {now_ms}
```

### Progress (frequent)

```redis
# server validates, then:
HSET race:{raceId}:progress {playerId} "{idx},{errors},{elapsed_ms}"
XADD events:race:{raceId} * type progress player {playerId} idx {idx} errors {errors} elapsed_ms {elapsed_ms}
# aggregate and broadcast pb every 50-200ms (throttle)
```

### Finish (atomic)

Run the Lua script above to RPUSH race:{raceId}:order and ZADD race:{raceId}:results. Then:

```redis
XADD events:race:{raceId} * type finish player {playerId} place {place} time_ms {time}
PUBLISH race:{raceId}:channel <fb message or use WS server fanout>
```

## De-dup and anti-cheat rules (short)

- Use client s sequence numbers: store session:{sid}.last_seq. Ignore messages with s <= last_seq.
- Validate idx monotonic increase. Reject impossible jumps (e.g., > X chars in Y ms).
- Rate-limit p messages (server-side).
- Server authoritative — do not accept client-specified place; server calculates placement via finish time and/or validated idx.
- On suspicious activity, mark session and optionally drop.

## Edge cases

- **Late join:** disallow after starting-countdown begins (or allow as spectator). If allowed, set role spectator in session:{sid}.
- **Reconnect:** allow mapping new WS connection to existing session:{sid} within reconnect_grace and refresh last_seen.
- **All disconnected:** if all players disconnect for X seconds, consider race finished with current placements or abort per policy.
- **Partial finish (time expired):** on time expiry, mark race finished and compute placement by best idx (or last reported progress timestamp).

## Simple ASCII sequence diagram

(Join → Start countdown → Running progress → Finish)

```
ClientA    ClientB    WS Server        Redis            Background
   |          |           |               |                  |
   |-- j ---> |           |               |                  |
   |          |-- j --->  |               |                  |
   |          |           |-- MULTI/EXEC ->| ZADD / XADD      |
   |          |           |<-- ja ------- |                  |
   |<-- ja ---|           |               |                  |
   |          |           |               |                  |
   |          |           |-- start req ->| HSET race state  |
   |          |           |               | XADD start event |
   |          |           |<-- st(count) -|                  |
   |   (countdown ticks)  |               |                  |
   |-- p ---> |-- p --->  |               |                  |
   |          |           |-- validate ->  | HSET progress    |
   |          |           |   XADD progress|                  |
   |          |           |<-- pb (agg) ---|                  |
   |-- f ---> |           |-- Lua finish ->| RPUSH / ZADD     |
   |          |           |   XADD finish  |                  |
   |<-- fb --- |          |<-- fb -------- |                  |
   |          |           |               |  (archive later) |
```

### Sequence note (explain briefly)

1. WS Server receives j and writes session + ZADD + XADD (join event).
2. Host triggers start; server writes starting-countdown and schedules server-side ticks.
3. When running, clients send p which are validated and saved; server broadcasts aggregated pb.
4. On f, server uses Lua to atomically record finish and publish fb. Final st contains full leaderboard.

## Implementation checklist (practical)

- [ ] Implement Redis schema and Lua finish script.
- [ ] WS handler: parse compact envelope, enforce sequence s, authenticate u or token.
- [ ] Implement j, p, f handlers that persist to Redis Streams and compact hashes.
- [ ] Implement server-side countdown timer and state transitions.
- [ ] Implement broadcast aggregator (throttle pb to ~50–200ms).
- [ ] Implement reconnect logic and session sliding TTL.
- [ ] Background worker: consumer group on events:race:{id} to export/archive.
- [ ] Instrument metrics: latencies, dropped messages, finish anomalies.
- [ ] Add unit/integration tests for finish atomicity, reconnect, and cheating heuristics.

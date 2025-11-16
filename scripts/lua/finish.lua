-- Atomic finish Lua script for TypeRacer
-- Guarantees a single successful finish recording per player (idempotent)
-- ARGV[1] = raceId, ARGV[2] = playerId, ARGV[3] = finish_time_ms

local race_prefix = "race:{" .. ARGV[1] .. "}"
local finished_key = race_prefix .. ":finished"

-- Check if player has already finished
if redis.call('HEXISTS', finished_key, ARGV[2]) == 0 then
  -- Player hasn't finished yet, record their finish
  redis.call('RPUSH', race_prefix .. ":order", ARGV[2])
  redis.call('ZADD', race_prefix .. ":results", ARGV[3], ARGV[2])
  redis.call('HSET', finished_key, ARGV[2], ARGV[3])
  
  -- Get the current position (1-based)
  local position = redis.call('LLEN', race_prefix .. ":order")
  
  return {1, position}  -- success, position
end

return {0, 0}  -- already finished

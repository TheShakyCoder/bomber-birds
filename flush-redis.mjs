/**
 * One-time script to flush stale Colyseus Redis state after a schema change.
 * Run with: node flush-redis.mjs
 * Then restart PM2: pm2 restart sbm
 */
import Redis from "ioredis";

const url = process.env.REDIS_URL
  ? `redis://${process.env.REDIS_URL}`
  : "redis://localhost:6379";

console.log(`Connecting to Redis at ${url} ...`);
const client = new Redis(url);

// Scan and delete all Colyseus-managed keys
let cursor = "0";
let deleted = 0;
do {
  const [nextCursor, keys] = await client.scan(cursor, "MATCH", "colyseus:*", "COUNT", 100);
  cursor = nextCursor;
  if (keys.length) {
    await client.del(...keys);
    deleted += keys.length;
    console.log(`Deleted ${keys.length} key(s): ${keys.join(", ")}`);
  }
} while (cursor !== "0");

console.log(`Done — ${deleted} Colyseus key(s) removed.`);
client.disconnect();

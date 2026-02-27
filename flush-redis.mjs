/**
 * Flush stale Colyseus Redis state after a schema change.
 *
 * Usage (pass URL directly - no .env needed):
 *   bun flush-redis.mjs redis://10.0.0.6:6379
 *   node flush-redis.mjs redis://10.0.0.6:6379
 *
 * Falls back to REDIS_URL env var, then localhost.
 */
import Redis from "ioredis";

const arg = process.argv[2];
const url = arg
  ?? (process.env.REDIS_URL ? `redis://${process.env.REDIS_URL}` : null)
  ?? "redis://localhost:6379";

console.log(`Connecting to ${url} ...`);
const client = new Redis(url, { lazyConnect: true, connectTimeout: 5000 });

try {
  await client.connect();
  console.log("Connected.");

  let cursor = "0";
  let deleted = 0;
  do {
    const [nextCursor, keys] = await client.scan(cursor, "MATCH", "colyseus:*", "COUNT", 100);
    cursor = nextCursor;
    if (keys.length) {
      await client.del(...keys);
      deleted += keys.length;
      console.log(`  Deleted: ${keys.join(", ")}`);
    }
  } while (cursor !== "0");

  console.log(`Done — ${deleted} Colyseus key(s) removed.`);
} catch (e) {
  console.error("Failed:", e.message);
} finally {
  client.disconnect();
}

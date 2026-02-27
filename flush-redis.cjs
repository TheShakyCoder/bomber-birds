// CommonJS flush script - works with plain `node`, no ESM quirks
// Usage: node flush-redis.cjs
const Redis = require("ioredis");

const redis = new Redis({ host: "10.0.0.6", port: 6379 });

redis.on("error", (err) => {
  console.error("Redis error:", err.message);
  process.exit(1);
});

redis.on("connect", async () => {
  console.log("Connected to Redis");
  try {
    const result = await redis.flushdb();
    console.log("FLUSHDB result:", result);
    console.log("Done - all keys cleared.");
  } catch (e) {
    console.error("Flush failed:", e.message);
  }
  redis.disconnect();
  process.exit(0);
});

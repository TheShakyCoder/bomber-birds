// Absolute simplest flush - callback style, no async
const Redis = require("ioredis");
const redis = new Redis({ host: "10.0.0.6", port: 6379 });

redis.on("error", function(err) {
  console.error("ERR:", err.message);
});

// flushdb with callback — no async/await needed
redis.flushdb(function(err, result) {
  if (err) {
    console.error("Flush failed:", err.message);
  } else {
    console.log("FLUSHDB:", result);
    console.log("Done!");
  }
  redis.disconnect();
  process.exit(0);
});

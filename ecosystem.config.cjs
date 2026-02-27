module.exports = {
    apps: [
        {
            name: "sbm",
            script: "build/index.js",
            instances: "max",      // One worker per CPU core
            exec_mode: "cluster",  // Safe now that Redis handles shared matchmaker state
            interpreter: "node",
            env_production: {
                NODE_ENV: "production",
                REDIS_URL: "redis://<YOUR_REDIS_SERVER_IP>:6379",
            },
        },
    ],
};

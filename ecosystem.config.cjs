module.exports = {
    apps: [
        {
            name: "sbm",
            script: "build/index.js",
            instances: 1,          // MUST be 1 — Colyseus matchmaker is in-memory
            exec_mode: "fork",     // NOT cluster — cluster splits WebSocket affinity
            interpreter: "node",
            env_production: {
                NODE_ENV: "production",
            },
        },
    ],
};

module.exports = {
    apps: [
        {
            name: "bomber-birds",
            script: "build/index.js",
            // TODO: Switch to instances: "max" + exec_mode: "cluster" once Redis is ready
            instances: 1,
            exec_mode: "fork",
            interpreter: "bun",
            env_production: {
                NODE_ENV: "production",
                REDIS_URL: "redis://10.0.0.6:6379",
                VITE_SERVER_PORT: 2567,
                VITE_DOMAIN: "bomber-birds.on-forge.com",
                VITE_SERVER_URL: "https://bomber-birds.on-forge.com/colyseus/",
                VITE_WS_URL: "wss://bomber-birds.on-forge.com/colyseus/",
                VITE_ORIGIN: "https://bomber-birds.on-forge.com",
            },
        },
    ],
};

module.exports = {
    apps: [
        {
            name: "sbm",
            script: "build/index.js",
            // TODO: Switch to instances: "max" + exec_mode: "cluster" once Redis is ready
            instances: 1,
            exec_mode: "fork",
            interpreter: "bun",
            env_production: {
                NODE_ENV: "production",
                REDIS_URL: "redis://10.0.0.6:6379",
            },
        },
    ],
};

module.exports = {
    apps: [
        {
            name: "sbm",
            script: "build/index.js",
            // TODO: Switch to instances: "max" + exec_mode: "cluster" once Redis is ready
            instances: 1,
            exec_mode: "fork",
            interpreter: "node",
            env_production: {
                NODE_ENV: "production",
                // REDIS_URL: "redis://<YOUR_REDIS_SERVER_IP>:6379",  // Uncomment when Redis is ready
            },
        },
    ],
};

module.exports = {
    apps: [
        {
            name: "sbm",
            script: "build/index.js",
            // TODO: Switch to instances: "max" + exec_mode: "cluster" once Redis is ready
            instances: "max",
            exec_mode: "cluster",
            interpreter: "node",
            env_production: {
                NODE_ENV: "production",
                REDIS_URL: "redis://" + process.env.REDIS_URL,  // Uncomment when Redis is ready
            },
        },
    ],
};

module.exports = {
    apps: [
        {
            name: "bomber-birds",
            script: "build/index.js",
            // TODO: Switch to instances: "max" + exec_mode: "cluster" once Redis is ready
            instances: 1,
            exec_mode: "fork",
            interpreter: "node"
        },
    ],
};

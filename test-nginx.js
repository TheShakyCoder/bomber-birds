const { URL } = require('url');

const clientUrl = "wss://bomber-birds.on-forge.com/colyseus";
const parsed = new URL(clientUrl);
console.log(parsed.pathname);

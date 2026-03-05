const { URL } = require('url');

const clientUrl = "wss://bomber-birds.sharifkhan.co.uk/colyseus";
const parsed = new URL(clientUrl);
console.log(parsed.pathname);

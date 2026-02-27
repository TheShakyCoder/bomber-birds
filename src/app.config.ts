import { Encoder } from "@colyseus/schema";
Encoder.BUFFER_SIZE = 16 * 1024; // 16 KB

import {
    defineRoom,
    monitor,
    playground,
    matchMaker,
    Server,
    createRouter,
    createEndpoint,
} from "colyseus";

import defineServer from "@colyseus/tools";
import { RedisPresence } from "@colyseus/redis-presence";
import { RedisDriver } from "@colyseus/redis-driver";

import path from "path";
import { fileURLToPath } from "url";

/**
 * Import your Room files
 */
import { MyRoom } from "./rooms/MyRoom.js";
import { PartyRoom } from "./rooms/PartyRoom.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REDIS_URL = process.env.REDIS_URL;

// Build server options — only use Redis if REDIS_URL is explicitly provided
const serverOptions: any = {
    publicAddress: process.env.COLYSEUS_PUBLIC_ADDRESS,
};

if (REDIS_URL) {
    console.log(`Using Redis at ${REDIS_URL}`);
    serverOptions.presence = new RedisPresence(REDIS_URL);
    serverOptions.driver = new RedisDriver(REDIS_URL);
} else {
    console.log("No REDIS_URL set — using in-memory presence/driver (single instance mode)");
}

const server = defineServer({
    options: serverOptions,
    routes: createRouter({
        "/": createEndpoint("/", { method: "GET" }, async (ctx) => {
            return new Response("Colyseus Server is Running!");
        }),
        
        "/ping": createEndpoint("/ping", { method: "GET" }, async (ctx) => {
            console.log(`[PID ${process.pid}] Server: GET /ping hit`);
            return ctx.json({ 
                envUrl: process.env.VITE_WS_URL || "LFC",
                status: "pong", 
                time: new Date().toISOString(), 
                pid: process.pid,
                publicAddress: (matchMaker as any).publicAddress || "EFC",
                colyseusEnv: process.env.COLYSEUS_PUBLIC_ADDRESS || "MISSING"
            });
        }),

        "/api/rooms": createEndpoint("/api/rooms", { method: "GET" }, async (ctx) => {
            console.log(`[PID ${process.pid}] Server: GET /api/rooms hit`);
            try {
                const rooms = await matchMaker.query({ name: "my_room" });
                return ctx.json(rooms);
            } catch (e) {
                console.error(`[PID ${process.pid}] Server: Error fetching rooms:`, e);
                return ctx.json({ error: String(e) }, { status: 500 });
            }
        }),

        "/party-id/:code": createEndpoint("/party-id/:code", { method: "GET" }, async (ctx) => {
            try {
                const searchCode = ctx.params.code.trim().toUpperCase();
                const rooms = await matchMaker.query({ name: "party" });
                const room = rooms.find(r => {
                    const roomCode = (r.metadata && r.metadata.inviteCode) ? r.metadata.inviteCode.trim().toUpperCase() : "";
                    return roomCode === searchCode;
                });

                if (room) {
                    return ctx.json({ roomId: room.roomId });
                } else {
                    return ctx.json({ error: "Party not found" }, { status: 404 });
                }
            } catch (e) {
                return ctx.json({ error: String(e) }, { status: 500 });
            }
        }),

        "/api/test": createEndpoint("/api/test", { method: "GET" }, async (ctx) => {
            return ctx.json({ status: "ok", time: new Date().toISOString() });
        }),

        "/admin/flush-redis": createEndpoint("/admin/flush-redis", { method: "POST" }, async (ctx) => {
            // Simple secret guard - pass header X-Flush-Secret: bombflush
            const secret = (ctx.request as Request).headers.get("x-flush-secret");
            if (secret !== "bombflush") {
                return ctx.json({ error: "Forbidden" }, { status: 403 });
            }
            try {
                const { RedisPresence } = await import("@colyseus/redis-presence");
                const presence = new RedisPresence(REDIS_URL) as any;
                // Access the underlying ioredis client
                const redis = presence.sub || presence.pub || presence.redis || presence.client;
                if (!redis) {
                    return ctx.json({ error: "Could not access Redis client" }, { status: 500 });
                }
                let cursor = "0";
                let deleted = 0;
                const deletedKeys: string[] = [];
                do {
                    const [nextCursor, keys]: [string, string[]] = await redis.scan(cursor, "MATCH", "colyseus:*", "COUNT", 100);
                    cursor = nextCursor;
                    if (keys.length) {
                        await redis.del(...keys);
                        deleted += keys.length;
                        deletedKeys.push(...keys);
                    }
                } while (cursor !== "0");
                presence.quit?.();
                return ctx.json({ deleted, keys: deletedKeys });
            } catch (e: any) {
                return ctx.json({ error: String(e.message) }, { status: 500 });
            }
        }),

        "/**": createEndpoint("/**", { method: "GET" }, async (ctx) => {
            console.log(`Server: 404 - Route not found: ${ctx.path}`);
            return new Response(`Route not found in router: ${ctx.path}`, { status: 404 });
        }),
    }),

    rooms: {
        my_room: defineRoom(MyRoom),
        party: defineRoom(PartyRoom)
    },

    initializeGameServer: async (gameServer: Server) => {
        const transport = (gameServer as any).transport;
        const router = (gameServer as any).router;

        if (transport && router && typeof transport.bindRouter === 'function') {
            transport.bindRouter(router);
        }

        // Only bootstrap a room from the first PM2 worker to avoid race conditions
        // in cluster mode. process.env.pm_id is '0' for the primary worker.
        const isPrimaryWorker = !process.env.pm_id || process.env.pm_id === '0';
        if (isPrimaryWorker) {
            try {
                const rooms = await matchMaker.query({ name: "my_room" });
                if (rooms.length === 0) {
                    const room = await matchMaker.createRoom("my_room", { name: "Alpha" });
                    console.log(`[PID ${process.pid}] Server: Bootstrapped room ${room.roomId}`);
                } else {
                    console.log(`[PID ${process.pid}] Server: Room already exists: ${rooms[0].roomId}`);
                }
            } catch (e) {
                console.error(`[PID ${process.pid}] Server: Error during room bootstrapping:`, e);
            }
        } else {
            console.log(`[PID ${process.pid}] Worker ${process.env.pm_id}: skipping room bootstrap (not primary)`);
        }
    }
});

export default server;
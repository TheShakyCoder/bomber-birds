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

import path from "path";
import { fileURLToPath } from "url";

/**
 * Import your Room files
 */
import { MyRoom } from "./rooms/MyRoom.js";
import { PartyRoom } from "./rooms/PartyRoom.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = defineServer({
    routes: createRouter({
        "/": createEndpoint("/", { method: "GET" }, async (ctx) => {
            return new Response("Colyseus Server is Running!");
        }),

        "/api/rooms": createEndpoint("/api/rooms", { method: "GET" }, async (ctx) => {
            try {
                const rooms = await matchMaker.query({ name: "my_room" });
                return ctx.json(rooms);
            } catch (e) {
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

        "/**": createEndpoint("/**", { method: "GET" }, async (ctx) => {
            return new Response(`Route not found in router: ${ctx.path}`, { status: 404 });
        }),
    }),

    rooms: {
        my_room: defineRoom(MyRoom),
        party: defineRoom(PartyRoom)
    },

    initializeGameServer: async (gameServer: Server) => {
        // Diagnostic: Check transport and router
        const transport = (gameServer as any).transport;
        const router = (gameServer as any).router;

        if (transport && router && typeof transport.bindRouter === 'function') {
            transport.bindRouter(router);
        }

        try {
            const existingRooms = await matchMaker.query({ name: "my_room" });
            if (existingRooms.length === 0) {
                await matchMaker.createRoom("my_room", { name: "Alpha" });
            }
        } catch (e) {
            console.error("Error during room bootstrapping:", e);
        }
    }
});

export default server;
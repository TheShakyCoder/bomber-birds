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
            console.log("ROUTER: Matched /");
            return new Response("Colyseus Server is Running!");
        }),

        "/api/rooms": createEndpoint("/api/rooms", { method: "GET" }, async (ctx) => {
            console.log("ROUTER: Matched /api/rooms");
            try {
                const rooms = await matchMaker.query({ name: "my_room" });
                return ctx.json(rooms);
            } catch (e) {
                console.error("ROUTER ERROR /api/rooms:", e);
                return ctx.json({ error: String(e) }, { status: 500 });
            }
        }),

        "/party-id/:code": createEndpoint("/party-id/:code", { method: "GET" }, async (ctx) => {
            console.log("ROUTER: Matched /party-id/:code", ctx.params.code);
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
            console.log("ROUTER: Matched /api/test");
            return ctx.json({ status: "ok", time: new Date().toISOString() });
        }),

        "/**": createEndpoint("/**", { method: "GET" }, async (ctx) => {
            console.log("ROUTER: CATCH-ALL HIT!", ctx.path);
            return new Response(`Route not found in router: ${ctx.path}`, { status: 404 });
        }),
    }),

    rooms: {
        my_room: defineRoom(MyRoom),
        party: defineRoom(PartyRoom)
    },

    initializeGameServer: async (gameServer: Server) => {
        console.log("------------------------------------------");
        console.log("GAME SERVER INITIALIZING...");
        console.log("------------------------------------------");

        // Diagnostic: Check transport and router
        const transport = (gameServer as any).transport;
        const router = (gameServer as any).router;

        console.log("Transport check:", transport ? "Found" : "Missing");
        console.log("Router check:", router ? "Found" : "Missing");

        if (transport && router && typeof transport.bindRouter === 'function') {
            console.log("Manually binding router to transport...");
            transport.bindRouter(router);
            
            // Log registered endpoints
            if (router.endpoints) {
                console.log("Registered endpoints:", Object.keys(router.endpoints));
                Object.values(router.endpoints).forEach((endpoint: any) => {
                    console.log(`  - ${endpoint.options.method} ${endpoint.path}`);
                });
            }
        } else {
            console.warn("Could not manually bind router. Transport or Router missing, or bindRouter not a function.");
            if (transport) console.log("Transport type:", transport.constructor.name);
        }

        try {
            const existingRooms = await matchMaker.query({ name: "my_room" });
            if (existingRooms.length === 0) {
                console.log("Initializing Alpha room...");
                await matchMaker.createRoom("my_room", { name: "Alpha" });
            }
        } catch (e) {
            console.error("Error during room bootstrapping:", e);
        }
        console.log("------------------------------------------");
    }
});

export default server;
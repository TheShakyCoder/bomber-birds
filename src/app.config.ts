import { Encoder } from "@colyseus/schema";
Encoder.BUFFER_SIZE = 16 * 1024; // 16 KB

import {
    defineServer,
    defineRoom,
    monitor,
    playground,
    matchMaker,
} from "colyseus";

import express from "express";
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
    /**
     * Define your room handlers:
     */
    rooms: {
        my_room: defineRoom(MyRoom),
        party: defineRoom(PartyRoom)
    },

    /**
     * Bind your custom express routes here:
     * Read more: https://expressjs.com/en/starter/basic-routing.html
     */
    express: (app) => {
        // Serve static files from the public directory
        const publicPath = path.resolve(__dirname, "..", "public");
        app.use(express.static(publicPath));

        app.get("/api/rooms", async (req, res) => {
            try {
                const rooms = await matchMaker.query({ name: "my_room" });
                res.json(rooms);
            } catch (e) {
                res.status(500).json({ error: (e instanceof Error) ? e.message : String(e) });
            }
        });

        app.get("/party-id/:code", async (req, res) => {
            try {
                const searchCode = req.params.code.trim().toUpperCase();
                const rooms = await matchMaker.query({ name: "party" });
                console.log(`Searching for party code: [${searchCode}]. Found ${rooms.length} party rooms.`);

                const room = rooms.find(r => {
                    const roomCode = (r.metadata && r.metadata.inviteCode) ? r.metadata.inviteCode.trim().toUpperCase() : "";
                    return roomCode === searchCode;
                });

                if (room) {
                    console.log(`Found party! RoomId: ${room.roomId}`);
                    res.json({ roomId: room.roomId });
                } else {
                    console.log(`Party not found for code: [${searchCode}]`);
                    res.status(404).json({ error: "Party not found" });
                }
            } catch (e) {
                res.status(500).json({ error: (e instanceof Error) ? e.message : String(e) });
            }
        });

        app.get("/api/hello", (req, res) => {
            res.json({ message: "Hello World" });
        });

        app.get("/hi", (req, res) => {
            res.send("It's time to kick ass and chew bubblegum!");
        });

        /**
         * Use @colyseus/monitor
         * It is recommended to protect this route with a password
         * Read more: https://docs.colyseus.io/tools/monitoring/#restrict-access-to-the-panel-using-a-password
         */
        app.use("/monitor", monitor());

        /**
         * Use @colyseus/playground
         * (It is not recommended to expose this route in a production environment)
         */
        if (process.env.NODE_ENV !== "production") {
            app.use("/playground", playground());
        }

        // Fallback to index.html for SPA routing
        app.get("*", (req, res) => {
            const indexFile = path.join(publicPath, "index.html");
            res.sendFile(indexFile);
        });
    }

});

export default server;
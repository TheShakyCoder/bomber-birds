import { Encoder } from "@colyseus/schema";
Encoder.BUFFER_SIZE = 16 * 1024; // 16 KB

import {
    defineServer,
    defineRoom,
    monitor,
    playground,
    createRouter,
    createEndpoint,
    matchMaker,
} from "colyseus";

/**
 * Import your Room files
 */
import { MyRoom } from "./rooms/MyRoom.js";
import { PartyRoom } from "./rooms/PartyRoom.js";

const server = defineServer({
    /**
     * Define your room handlers:
     */
    rooms: {
        my_room: defineRoom(MyRoom),
        party: defineRoom(PartyRoom)
    },

    /**
     * Experimental: Define API routes. Built-in integration with the "playground" and SDK.
     * 
     * Usage from SDK: 
     *   client.http.get("/api/hello").then((response) => {})
     * 
     */
    routes: createRouter({
        available_rooms: createEndpoint("/rooms", { method: "GET" }, async (ctx) => {
            return await matchMaker.query({ name: "my_room" });
        }),
        party_id: createEndpoint("/party-id/:code", { method: "GET" }, async (ctx) => {
            const searchCode = ctx.params.code.trim().toUpperCase();
            const rooms = await matchMaker.query({ name: "party" });
            console.log(`Searching for party code: [${searchCode}]. Found ${rooms.length} party rooms.`);

            const room = rooms.find(r => {
                const roomCode = (r.metadata && r.metadata.inviteCode) ? r.metadata.inviteCode.trim().toUpperCase() : "";
                return roomCode === searchCode;
            });

            if (room) {
                console.log(`Found party! RoomId: ${room.roomId}`);
                return { roomId: room.roomId };
            } else {
                console.log(`Party not found for code: [${searchCode}]`);
                return { error: "Party not found" };
            }
        }),
        api_hello: createEndpoint("/api/hello", { method: "GET", }, async (ctx) => {
            return { message: "Hello World" }
        })
    }),

    /**
     * Bind your custom express routes here:
     * Read more: https://expressjs.com/en/starter/basic-routing.html
     */
    express: (app) => {
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
            app.use("/", playground());
        }
    }

});

export default server;
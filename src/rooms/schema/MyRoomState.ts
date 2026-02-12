import { Schema, type, MapSchema } from "@colyseus/schema";

export class Player extends Schema {
    @type("number") x: number = 0;
    @type("number") z: number = 0;
    @type("boolean") alive: boolean = true;
    @type("number") health: number = 100;
    @type("boolean") ready: boolean = false;
    @type("number") team: number = -1;
    @type("string") partyId: string = "";
    @type("boolean") loaded: boolean = false;
}

export class Block extends Schema {
    @type("string") type: string = "destructible"; // "indestructible" | "destructible"
}

export class Bomb extends Schema {
    @type("number") x: number = 0;
    @type("number") z: number = 0;
    @type("string") ownerId: string = "";
}

export class MyRoomState extends Schema {
    @type({ map: Player }) players = new MapSchema<Player>();
    @type({ map: Block }) grid = new MapSchema<Block>(); // Keyed by "x,z"
    @type({ map: Bomb }) bombs = new MapSchema<Bomb>(); // Keyed by "x,z"
    @type("string") winnerId: string = "";
    @type("boolean") gameStarted: boolean = false;
    @type("string") roomName: string = "Lobby";
    @type("number") countdown: number = 0;
}

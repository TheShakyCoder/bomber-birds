import { Schema, type, MapSchema } from "@colyseus/schema";
import { Player } from "./Player.js";
import { Block } from "./Block.js";
import { Base } from "./Base.js";
import { Bomb } from "./Bomb.js";
import { Tower } from "./Tower.js";

export class MyRoomState extends Schema {
    @type({ map: Player }) players = new MapSchema<Player>();
    @type({ map: Block }) grid = new MapSchema<Block>(); // Keyed by "x,z"
    @type({ map: Base }) bases = new MapSchema<Base>(); // Keyed by "x,z"
    @type({ map: Bomb }) bombs = new MapSchema<Bomb>(); // Keyed by "x,z"
    @type("string") winnerId: string = "";
    @type("boolean") gameStarted: boolean = false;
    @type("string") roomName: string = "Lobby";
    @type("number") countdown: number = 0;
    @type("number") roomSize: number = 25;
    @type({ map: Tower }) towers = new MapSchema<Tower>(); // Keyed by "x,z"
}

import { Schema, MapSchema, defineTypes } from "@colyseus/schema";

export class Player extends Schema {}
defineTypes(Player, {
    x: "number",
    z: "number",
    alive: "boolean",
    health: "number"
});

export class Block extends Schema {}
defineTypes(Block, {
    type: "string"
});

export class Bomb extends Schema {}
defineTypes(Bomb, {
    x: "number",
    z: "number",
    ownerId: "string"
});

export class MyRoomState extends Schema {}
defineTypes(MyRoomState, {
    players: { map: Player },
    grid: { map: Block },
    bombs: { map: Bomb },
    winnerId: "string"
});

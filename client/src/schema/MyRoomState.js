import { Schema, MapSchema, defineTypes } from "@colyseus/schema";

export class Player extends Schema {}
defineTypes(Player, {
    x: "number",
    z: "number",
    alive: "boolean",
    health: "number",
    ready: "boolean",
    team: "number",
    partyId: "string",
    loaded: "boolean",
    coins: "number",
    bombRange: "number"
});

export class Block extends Schema {}
defineTypes(Block, {
    type: "string"
});

export class Base extends Schema {}
defineTypes(Base, {
    health: "number",
    team: "number"
});

export class Tower extends Schema {}
defineTypes(Tower, {
    health: "number",
    team: "number"
});

export class MyRoomState extends Schema {}
defineTypes(MyRoomState, {
    players: { map: Player },
    grid: { map: Block },
    bases: { map: Base },
    bombs: { map: Bomb },
    winnerId: "string",
    gameStarted: "boolean",
    roomName: "string",
    countdown: "number",
    roomSize: "number",
    towers: { map: Tower }
});

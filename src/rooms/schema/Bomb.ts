import { Schema, type } from "@colyseus/schema";

export class Bomb extends Schema {
    @type("number") x: number = 0;
    @type("number") z: number = 0;
    @type("string") ownerId: string = "";
    @type("number") team: number = -1;
    @type("number") explosionTimestamp: number = 0;
}

import { Schema, type } from "@colyseus/schema";

export class Coin extends Schema {
    @type("number") x: number = 0;
    @type("number") z: number = 0;
}

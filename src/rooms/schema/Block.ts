import { Schema, type, MapSchema } from "@colyseus/schema";

export class Block extends Schema {
    @type("string") type: string = "destructible"; // "indestructible" | "destructible"
}
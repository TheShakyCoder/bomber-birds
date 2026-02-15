import { Schema, type } from "@colyseus/schema";

export class Tower extends Schema {
    @type("number") health: number = 500;
    @type("number") team: number = -1;
}
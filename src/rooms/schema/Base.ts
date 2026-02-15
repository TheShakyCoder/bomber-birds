import { Schema, type } from "@colyseus/schema";

export class Base extends Schema {
    @type("number") health: number = 200;
    @type("number") team: number = -1;
}
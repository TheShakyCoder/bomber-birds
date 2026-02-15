import { Schema, type, } from "@colyseus/schema";

export class Player extends Schema {
    @type("number") x: number = 0;
    @type("number") z: number = 0;
    @type("boolean") alive: boolean = true;
    @type("number") health: number = 100;
    @type("boolean") ready: boolean = false;
    @type("number") team: number = -1;
    @type("string") partyId: string = "";
    @type("boolean") loaded: boolean = false;
    @type("boolean") isBot: boolean = false;
    @type("number") deathCount: number = 0;
    @type("number") respawnTimestamp: number = 0;
}

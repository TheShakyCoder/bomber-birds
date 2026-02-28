import { Schema, type, } from "@colyseus/schema";

export class Player extends Schema {
    @type("number") x: number = 0;
    @type("number") z: number = 0;
    @type("boolean") alive: boolean = true;
    @type("boolean") ready: boolean = false;
    @type("number") team: number = -1;
    @type("string") partyId: string = "";
    @type("boolean") loaded: boolean = false;
    @type("boolean") isBot: boolean = false; // Kept for schema backward compat — unused
    @type("number") deathCount: number = 0;
    @type("number") respawnTimestamp: number = 0;
    @type("number") coins: number = 0;

    // Bird type & stats
    @type("string") birdType: string = "";
    @type("number") health: number = 100;
    @type("number") maxHealth: number = 100;
    @type("number") armor: number = 0;
    @type("number") attack: number = 50;
    @type("number") critDamage: number = 1.5;
    @type("number") critChance: number = 10;
    @type("number") weaponDirections: number = 4;
    @type("number") weaponRange: number = 1;
    @type("number") moveSpeed: number = 1;
    @type("number") lastDx: number = 0;  // last move direction for 1-dir birds
    @type("number") lastDz: number = 1;
}

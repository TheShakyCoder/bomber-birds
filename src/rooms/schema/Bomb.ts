import { Schema, type } from "@colyseus/schema";

export class Bomb extends Schema {
    @type("number") x: number = 0;
    @type("number") z: number = 0;
    @type("string") ownerId: string = "";
    @type("number") team: number = -1;
    @type("number") explosionTimestamp: number = 0;
    @type("number") aimDx: number = 0;
    @type("number") aimDz: number = 1;
    @type("number") weaponDirections: number = 4;
    @type("number") weaponRange: number = 1;
    @type("number") attack: number = 50;
    @type("number") critDamage: number = 1.5;
    @type("number") critChance: number = 10;
}

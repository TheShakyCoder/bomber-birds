import { Schema, MapSchema, type } from "@colyseus/schema";

export class PartyMember extends Schema {
    @type("string") sessionId: string;
    @type("boolean") ready: boolean = false;
    @type("boolean") isLeader: boolean = false;
}

export class PartyState extends Schema {
    @type({ map: PartyMember }) members = new MapSchema<PartyMember>();
    @type("string") inviteCode: string;
    @type("string") roomId: string;
    @type("string") roomName: string;
}

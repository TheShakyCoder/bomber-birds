import { Schema, MapSchema, defineTypes } from "@colyseus/schema";

export class PartyMember extends Schema {}
defineTypes(PartyMember, {
    sessionId: "string",
    ready: "boolean",
    isLeader: "boolean"
});

export class PartyState extends Schema {}
defineTypes(PartyState, {
    members: { map: PartyMember },
    inviteCode: "string",
    roomId: "string",
    roomName: "string"
});

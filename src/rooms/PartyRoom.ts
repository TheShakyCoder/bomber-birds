import { Room, Client } from "colyseus";
import { PartyState, PartyMember } from "./schema/PartyState.js";

export class PartyRoom extends Room<PartyState> {
    maxClients = 5;

    onCreate(options: any) {
        // 1. Initialize State immediately
        this.setState(new PartyState());
        
        // 2. Generate and store invite code
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        this.state.inviteCode = code;
        this.state.roomId = this.roomId;
        this.state.roomName = options.name || "Party Room";
        
        // 3. Set Metadata for matchmaker discovery WITHOUT DELAY
        this.setMetadata({ 
            inviteCode: code,
            roomName: this.state.roomName
        });

        console.log(`Party room created. ID: ${this.roomId}, Code: ${code}`);

        this.onMessage("requestPartyInit", (client) => {
            client.send("partyInit", { inviteCode: this.state.inviteCode });
        });

        this.onMessage("toggleReady", (client) => {
            const member = this.state.members.get(client.sessionId);
            if (member) {
                member.ready = !member.ready;
            }
        });

        this.onMessage("startGame", (client, message) => {
            const member = this.state.members.get(client.sessionId);
            if (member && member.isLeader) {
                this.broadcast("startJoinGame", { 
                    partyId: this.roomId,
                    roomId: message.roomId
                });
            }
        });

        this.onMessage("leaveGame", (client) => {
            const member = this.state.members.get(client.sessionId);
            if (member && member.isLeader) {
                this.broadcast("orderLeaveGame");
            }
        });
    }

    onJoin(client: Client, options: any) {
        const isLeader = this.clients.length === 1;
        const member = new PartyMember();
        member.sessionId = client.sessionId;
        member.isLeader = isLeader;
        
        this.state.members.set(client.sessionId, member);
        
        // Reliability: Send invite code via message immediately on join
        client.send("partyInit", { inviteCode: this.state.inviteCode });
        
        console.log(`Player ${client.sessionId} joined party ${this.roomId} with code ${this.state.inviteCode}`);
    }

    onLeave(client: Client, code: number) {
        this.state.members.delete(client.sessionId);
        
        if (this.state.members.size > 0) {
            const memberList = Array.from(this.state.members.keys());
            const newLeaderId = memberList[0];
            const newLeader = this.state.members.get(newLeaderId);
            if (newLeader) {
                newLeader.isLeader = true;
            }
        }
    }
}

import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import * as Colyseus from "@colyseus/sdk";

export const GREEK_LETTERS = [
    'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
    'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi',
    'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega'
];

export const useLobbyStore = defineStore('lobby', () => {
    let serverUrl = import.meta.env.VITE_WS_URL || "";
    
    // Auto-detect production URL if not explicitly provided
    if (!serverUrl && (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')) {
        // On Coolify, the container serves directly — no path prefix needed
        serverUrl = `${window.location.protocol}//${window.location.host}/`;
    }

    // Ensure it's a string and has a protocol if not defaulting
    if (serverUrl) {
        // MUST have a trailing slash, otherwise `new URL('matchmake', serverUrl)` 
        // will strip the `/colyseus` path and resolve to `/matchmake`.
        if (!serverUrl.endsWith('/')) {
            serverUrl += '/';
        }
        
        // CRITICAL: For browser 'fetch' and Colyseus HTTP calls, we MUST use http/https protocols.
        // Colyseus SDK will automatically upgrade to ws/wss for WebSocket connections.
        if (serverUrl.startsWith('ws')) {
            serverUrl = serverUrl.replace(/^ws/, 'http');
        }
    }

    console.log("LobbyStore: Initializing Colyseus", {
        envUrl: import.meta.env.VITE_WS_URL,
        hostname: window.location.hostname,
        finalUrl: serverUrl || "DEFAULT (window.location)"
    });

    const client = new Colyseus.Client(serverUrl || undefined);
    
    // State
    const currentRoom = shallowRef(null);
    const gameStarted = ref(false);
    const joinedParty = shallowRef(null);
    const partyMembers = ref({});
    const partyInviteCode = ref('');
    const isJoining = ref(false);
    const errorMessage = ref("");

    // UI State
    const rooms = ref([]);
    const isCreating = ref(false);
    const newRoomName = ref('');
    const isLoading = ref(true);
    const copySuccess = ref(false);
    const inviteToJoin = ref('');

    // Helpers
    const isPartyLeader = () => {
        if (!joinedParty.value || !partyMembers.value) return false;
        const myMember = partyMembers.value[joinedParty.value.sessionId];
        return myMember && myMember.isLeader;
    };

    const copyPartyCode = async () => {
        if (partyInviteCode.value) {
            try {
                await navigator.clipboard.writeText(partyInviteCode.value);
                console.log('Copied to clipboard: ', partyInviteCode.value);
                return true;
            } catch (err) {
                errorMessage.value = "Clipboard access denied. Please paste manually.";
                console.error('Failed to copy: ', err);
            }
        }
        return false;
    };

    const pastePartyCode = async () => {
        try {
            const code = await navigator.clipboard.readText();
            console.log('Pasting from clipboard: ', code);
            return code;
        } catch (err) {
            console.error('Failed to paste: ', err);
            errorMessage.value = "Clipboard access denied. Please paste manually.";
        }
        return '';
    };

    // Actions
    const onRoomJoined = (room) => {
        console.log("Room synced in Store:", (room.id || room.roomId));
        currentRoom.value = room;
        
        room.onStateChange((state) => {
            if (state.gameStarted) {
                gameStarted.value = true;
            } else {
                gameStarted.value = false;
            }
        });

        room.onLeave(() => {
            currentRoom.value = null;
            gameStarted.value = false;
        });
    };

    const onPartyJoined = (room) => {
        if (joinedParty.value && joinedParty.value.id === room.id) {
            console.log("Store: Already joined this party, skipping setup");
            return;
        }
        joinedParty.value = room;
        
        if (room.metadata?.inviteCode) partyInviteCode.value = room.metadata.inviteCode;
        
        room.onStateChange((state) => {
            if (!state) return;
            if (state.inviteCode) partyInviteCode.value = state.inviteCode;
            
            const members = {};
            state.members.forEach((m, id) => {
                members[id] = { ready: m.ready, isLeader: m.isLeader };
            });
            partyMembers.value = members;
        });

        room.onMessage("partyInit", (data) => {
            if (data.inviteCode) partyInviteCode.value = data.inviteCode;
        });

        room.onMessage("orderLeaveGame", () => {
            console.log("Store: Party Order received - Leaving Room");
            if (currentRoom.value) {
                currentRoom.value.leave();
                currentRoom.value = null;
                gameStarted.value = false;
            }
        });

        room.onMessage("startJoinGame", (data) => {
            console.log("Store: Received startJoinGame", data);
            joinRoomByLeader(data.roomId, data.partyId);
        });

        room.send("requestPartyInit");
    };

    const joinRoomByLeader = async (roomId, partyId) => {
        if (!roomId) return;
        if (isJoining.value) return;
        if (currentRoom.value && (currentRoom.value.id === roomId || currentRoom.value.roomId === roomId)) return;
        
        isJoining.value = true;
        try {
            console.log("Store: Following leader to room", roomId);
            const room = await client.joinById(roomId, { partyId });
            onRoomJoined(room);
        } catch (e) {
            console.error("Store: Follow leader failed:", e);
        } finally {
            isJoining.value = false;
        }
    };

    const createGameRoom = async (options = {}) => {
        if (joinedParty.value) {
            options.partyId = (joinedParty.value.id || joinedParty.value.roomId);
        }
        console.log("LobbyStore: Creating Room Reservation", {
            options
        });
        const room = await client.create("my_room", options);
        console.log("LobbyStore: Created Room Reservation", {
            roomId: room.roomId,
            sessionId: room.sessionId,
            connection: room.connection?.url
        });
        onRoomJoined(room);
        if (isPartyLeader()) {
            joinedParty.value.send("startGame", { roomId: (room.id || room.roomId) });
        }
        return room;
    };

    const joinGameRoom = async (roomId, options = {}) => {
        if (joinedParty.value && !options.partyId) {
            options.partyId = (joinedParty.value.id || joinedParty.value.roomId);
        }
        const room = await client.joinById(roomId, options);
        console.log("LobbyStore: Joined Room Reservation", {
            roomId: room.roomId,
            sessionId: room.sessionId,
            connection: room.connection?.url
        });
        onRoomJoined(room);
        if (isPartyLeader()) {
            joinedParty.value.send("startGame", { roomId: (room.id || room.roomId) });
        }
        return room;
    };

    const createParty = async () => {
        try {
            const room = await client.create("party", {});
            onPartyJoined(room);
        } catch (e) {
            errorMessage.value = "Failed to create party: " + e.message;
        }
    };

    const joinPartyByCode = async (inviteCode) => {
        if (!inviteCode) return;
        try {
            const cleanCode = inviteCode.trim().toUpperCase();
            errorMessage.value = "Joining party...";
            const response = await client.http.get(`party-id/${cleanCode}`);

            if (response.data && response.data.roomId) {
                const room = await client.joinById(response.data.roomId, {});
                onPartyJoined(room);
                errorMessage.value = "";
            } else {
                errorMessage.value = (response.data && response.data.error) || "Failed to find party.";
            }
        } catch (e) {
            errorMessage.value = "Failed to join party: " + e.message;
        }
    };

    const leaveParty = () => {
        if (joinedParty.value) {
            joinedParty.value.leave();
            joinedParty.value = null;
            partyMembers.value = {};
            partyInviteCode.value = '';
        }
    };

    const startPartyBattle = async () => {
        if (!joinedParty.value) return;
        errorMessage.value = "Finding game room for party...";
        try {
            const response = await client.http.get("api/rooms");
            if (response.data.length > 0) {
                await joinGameRoom(response.data[0].roomId);
            } else {
                const roomName = GREEK_LETTERS[Math.floor(Math.random() * GREEK_LETTERS.length)];
                await createGameRoom({ name: roomName });
            }
            errorMessage.value = "";
        } catch (e) {
            errorMessage.value = "Fail to start game: " + e.message;
        }
    };

    const leaveBattle = () => {
        if (currentRoom.value) {
            if (isPartyLeader()) {
                console.log("Store: Leader leaving - Signaling party");
                joinedParty.value.send("leaveGame");
            }
            currentRoom.value.leave();
            currentRoom.value = null;
            gameStarted.value = false;
        }
    };

    const togglePartyReady = () => {
        if (joinedParty.value) {
            joinedParty.value.send("toggleReady");
        }
    };

    const fetchRooms = async () => {
        try {
            const response = await client.http.get("api/rooms");
            rooms.value = response.data;
        } catch (e) {
            console.error("LobbyStore: fetchRooms Failed", {
                endpoint: client.endpoint,
                error: e.message,
                stack: e.stack
            });
            errorMessage.value = "Failed to fetch rooms: " + e.message;
        } finally {
            isLoading.value = false;
        }
    };

    return {
        client,
        currentRoom,
        gameStarted,
        joinedParty,
        partyMembers,
        partyInviteCode,
        isJoining,
        errorMessage,
        rooms,
        isCreating,
        newRoomName,
        isLoading,
        copySuccess,
        inviteToJoin,
        isPartyLeader,
        copyPartyCode,
        pastePartyCode,
        fetchRooms,
        createGameRoom,
        joinGameRoom,
        createParty,
        joinPartyByCode,
        leaveParty,
        startPartyBattle,
        leaveBattle,
        togglePartyReady
    };
});

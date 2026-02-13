export const GREEK_LETTERS = [
    'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
    'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi',
    'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega'
];

export const copyPartyCode = async (partyCode, errorMessage) => {
    if (partyCode) {
        try {
            await navigator.clipboard.writeText(partyCode);
            console.log('Copied to clipboard: ', partyCode);
            return true;
        } catch (err) {
            errorMessage.value = "Clipboard access denied. Please paste manually.";
            console.error('Failed to copy: ', err);
        }
    }
    return false;
};

export const pastePartyCode = async (errorMessage) => {
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

export const playerJoinsParty = async (inviteCode, errorMessage, client, handlePartyJoined) => {
    if (!inviteCode) return;
    try {
        const cleanCode = inviteCode.trim().toUpperCase();
        errorMessage.value = "Joining party...";
        const response = await client.http.get(`/party-id/${cleanCode}`);

        if (response.data && response.data.roomId) {
            const room = await client.joinById(response.data.roomId, {});
            handlePartyJoined(room);
            errorMessage.value = "";
        } else {
            errorMessage.value = (response.data && response.data.error) || "Failed to find party.";
        }
    } catch (e) {
        errorMessage.value = "Failed to join party: " + e.message;
    }
}

export const fetchRooms = async (client) => {
    try {
        const response = await client.http.get("/rooms");
        return response.data;
    } catch (e) {
        console.error("Failed to fetch rooms:", e);
        throw e;
    }
};

export const isPartyLeader = (party, partyMembers) => {
    if (!party || !partyMembers) return false;
    const myMember = partyMembers[party.sessionId];
    return myMember && myMember.isLeader;
};

export const createGameRoom = async (client, party, options = {}) => {
    if (party) {
        options.partyId = (party.id || party.roomId);
    }
    const room = await client.create("my_room", options);
    return room;
};

export const joinGameRoom = async (client, roomId, party, options = {}) => {
    if (party && !options.partyId) {
        options.partyId = (party.id || party.roomId);
    }
    const room = await client.joinById(roomId, options);
    return room;
};

export const createPartyRoom = async (client) => {
    const room = await client.create("party", {});
    return room;
};

export const startPartyBattle = async (client, joinRoomCallback, createRoomCallback) => {
    try {
        const response = await client.http.get("/rooms");
        if (response.data.length > 0) {
            await joinRoomCallback(response.data[0].roomId);
        } else {
            await createRoomCallback();
        }
    } catch (e) {
        throw new Error("Fail to start game: " + e.message);
    }
};

export const onRoomJoined = (room, currentRoom, gameStarted) => {
  console.log("Room synced in App:", (room.id || room.roomId));
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
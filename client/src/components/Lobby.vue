<script setup>
import { ref, onMounted, onUnmounted, shallowRef } from 'vue';
import * as Colyseus from "@colyseus/sdk";
// import { MyRoomState } from '../schema/MyRoomState.js';
// import { PartyState } from '../schema/PartyState.js';

const client = new Colyseus.Client('ws://localhost:2567');
const rooms = ref([]);
const isCreating = ref(false);
const newRoomName = ref('');
const errorMessage = ref('');
const isLoading = ref(true);
const joinedRoom = shallowRef(null);
const joinedParty = shallowRef(null);
const partyInviteCode = ref('');
const partyMembers = ref({});
const inviteToJoin = ref('');
const currentRoomName = ref('Initialising...');
const currentCountdown = ref(0);
const connectedPlayers = ref({});

const emit = defineEmits(['joined']);

const handleRoomJoined = (room) => {
  joinedRoom.value = room;
  room.onStateChange((state) => {
    currentRoomName.value = state.roomName || 'Lobby';
    currentCountdown.value = state.countdown || 0;
    
    // Convert MapSchema to plain object for Vue reactivity
    const p = {};
    state.players.forEach((player, id) => {
      p[id] = { ready: player.ready };
    });
    connectedPlayers.value = p;

    if (state.gameStarted) {
      emit('joined', room);
    }
  });
};

const toggleReady = () => {
  if (joinedRoom.value) {
    joinedRoom.value.send("ready");
  }
};

const leaveJoinedRoom = () => {
  if (joinedRoom.value) {
    joinedRoom.value.leave();
    joinedRoom.value = null;
  }
};

const fetchRooms = async () => {
  try {
    const response = await client.http.get("/rooms");
    rooms.value = response.data;
  } catch (e) {
    console.error("Failed to fetch rooms:", e);
  } finally {
    isLoading.value = false;
  }
};

let refreshInterval;

onMounted(() => {
  fetchRooms();
  refreshInterval = setInterval(fetchRooms, 3000);
});

onUnmounted(() => {
  clearInterval(refreshInterval);
});

const greekLetters = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
  'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi',
  'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega'
];

const isPartyLeader = () => {
  if (!joinedParty.value) {
    console.log("isPartyLeader: No joined party");
    return false;
  }
  const mySessionId = joinedParty.value.sessionId;
  const myMember = partyMembers.value[mySessionId];
  console.log("isPartyLeader check:", {
    mySessionId,
    myMember,
    allMembers: partyMembers.value,
    isLeader: myMember?.isLeader
  });
  return myMember && myMember.isLeader;
};

const createRoom = async () => {
  console.log("createRoom called. Party:", joinedParty.value?.roomId, "Is Leader:", isPartyLeader());
  
  if (joinedParty.value && !isPartyLeader()) {
    console.warn("Block: Non-leader attempted room creation");
    errorMessage.value = "Only the party leader can create a room.";
    return;
  }

  let roomName = newRoomName.value;
  if (!roomName) {
    roomName = greekLetters[Math.floor(Math.random() * greekLetters.length)];
  }
  
  try {
    const options = { name: roomName };
    if (joinedParty.value) {
      options.partyId = joinedParty.value.roomId;
    }
    
    const room = await client.create("my_room", options);
    handleRoomJoined(room);
    
    // Lead-Follow: Signal party to join if leader
    if (isPartyLeader()) {
      joinedParty.value.send("startGame", { roomId: room.roomId });
    }
  } catch (e) {
    errorMessage.value = "Failed to create room: " + e.message;
  }
};

const joinRoom = async (roomId, options = {}) => {
  console.log("joinRoom called for", roomId, "Party:", joinedParty.value?.roomId, "Is Leader:", isPartyLeader());

  if (joinedParty.value && !isPartyLeader() && !options.partyId) {
    console.warn("Block: Non-leader attempted manual join");
    errorMessage.value = "Only the party leader can join a room manually.";
    return;
  }

  try {
    // Fill in partyId if we are in one
    if (joinedParty.value && !options.partyId) {
      options.partyId = joinedParty.value.roomId;
    }

    const room = await client.joinById(roomId, options);
    handleRoomJoined(room);

    // Lead-Follow: Signal party to join if leader
    if (isPartyLeader()) {
      joinedParty.value.send("startGame", { roomId: room.roomId });
    }
  } catch (e) {
    errorMessage.value = "Failed to join room: " + e.message;
  }
};

const createParty = async () => {
  try {
    const room = await client.create("party", {});
    handlePartyJoined(room);
  } catch (e) {
    errorMessage.value = "Failed to create party: " + e.message;
  }
};

const joinParty = async () => {
  if (!inviteToJoin.value) return;
  try {
    const cleanCode = inviteToJoin.value.trim().toUpperCase();
    errorMessage.value = "Joining party...";
    // Resolve invite code to actual roomId first
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
};

const handlePartyJoined = (room) => {
  joinedParty.value = room;
  
  // Set initial state values immediately (metadata as reliable fallback)
  if (room.metadata && room.metadata.inviteCode) {
    partyInviteCode.value = room.metadata.inviteCode;
  } else if (room.state && room.state.inviteCode) {
    partyInviteCode.value = room.state.inviteCode;
  } else {
    partyInviteCode.value = 'FETCHING...';
  }

  // Explicitly request the code after join is finalized
  room.send("requestPartyInit");

  // Use focused property listener for inviteCode (more robust than onStateChange in some environments)
  room.state.listen?.("inviteCode", (value) => {
     if (value) partyInviteCode.value = value;
  });

  // Fail-safe: Direct message for the invite code
  room.onMessage("partyInit", (data) => {
    if (data.inviteCode) {
      partyInviteCode.value = data.inviteCode;
    }
  });

  room.onStateChange((state) => {
    if (!state) return;
    if (state.inviteCode) partyInviteCode.value = state.inviteCode;
    
    const members = {};
    if (state.members) {
      state.members.forEach((m, id) => {
        members[id] = { ready: m.ready, isLeader: m.isLeader };
      });
    }
    partyMembers.value = members;
  });

  room.onMessage("startJoinGame", async (data) => {
    // Join the specific room provided by the leader
    // Skip if we are already in that room (leader optimization)
    if (joinedRoom.value && joinedRoom.value.roomId === data.roomId) {
      return;
    }

    try {
        await joinRoom(data.roomId, { partyId: data.partyId });
    } catch (e) {
        console.error("Party auto-join failed:", e);
        errorMessage.value = "Failed to join game room: " + e.message;
    }
  });
};

const leaveParty = () => {
  if (joinedParty.value) {
    joinedParty.value.leave();
    joinedParty.value = null;
    partyMembers.value = {};
    partyInviteCode.value = '';
  }
};

const startPartyGame = async () => {
  if (joinedParty.value) {
    errorMessage.value = "Finding game room for party...";
    try {
        const response = await client.http.get("/rooms");
        if (response.data.length > 0) {
            await joinRoom(response.data[0].roomId);
        } else {
            await createRoom();
        }
        errorMessage.value = "";
    } catch (e) {
        errorMessage.value = "Fail to start game: " + e.message;
    }
  }
};

const togglePartyReady = () => {
    if (joinedParty.value) {
        joinedParty.value.send("toggleReady");
    }
}
</script>

<template>
  <div class="lobby-container">
    <div class="lobby-card">
      <header>
        <h1>Super Bomberman</h1>
        <p class="subtitle">Multiplayer Arena</p>
      </header>

      <div v-if="errorMessage" class="error-banner">
        {{ errorMessage }}
        <button @click="errorMessage = ''" class="close-btn">&times;</button>
      </div>

      <div v-if="joinedRoom" class="ready-room">
        <div class="ready-header">
          <div class="room-title">
            <span class="label">Battleground:</span>
            <h2>{{ currentRoomName }}</h2>
          </div>
          <button @click="leaveJoinedRoom" class="btn-ghost">Leave</button>
        </div>

        <div class="players-list">
          <div v-for="(player, id) in connectedPlayers" :key="id" class="player-ready-item">
            <span class="player-name">{{ id === joinedRoom.sessionId ? 'You' : 'Player ' + id.substring(0, 4) }}</span>
            <span class="ready-status" :class="{ 'is-ready': player.ready }">
              {{ player.ready ? 'READY' : 'WAITING' }}
            </span>
          </div>
        </div>

        <div class="ready-actions">
          <button 
            @click="toggleReady" 
            class="btn-ready" 
            :class="{ 'is-ready': connectedPlayers[joinedRoom.sessionId]?.ready }"
          >
            {{ connectedPlayers[joinedRoom.sessionId]?.ready ? 'I am Ready!' : 'Ready Up' }}
          </button>
          
          <div v-if="currentCountdown > 0" class="countdown-timer">
            <span class="countdown-label">Battle starts in:</span>
            <span class="countdown-value">{{ currentCountdown }}</span>
          </div>
          <p v-else class="waiting-hint">Waiting for all players to ready up...</p>
        </div>
      </div>

      <div v-else class="room-browser">
        <!-- Party System Section -->
        <div class="party-section">
            <div v-if="joinedParty" class="joined-party">
                <div class="party-header">
                    <h3>My Party: <code class="invite-code">{{ partyInviteCode }}</code></h3>
                    <button @click="leaveParty" class="btn-ghost btn-sm">Leave Party</button>
                </div>
                
                <div class="party-members-list">
                    <div v-for="(member, id) in partyMembers" :key="id" class="party-member">
                        <span class="member-name">
                            {{ id === joinedParty.sessionId ? 'You' : 'Member ' + id.substring(0, 4) }}
                            <span v-if="member.isLeader" class="leader-badge">Leader</span>
                        </span>
                        <span class="ready-dot" :class="{ 'is-ready': member.ready }"></span>
                    </div>
                </div>

                <div class="party-actions">
                    <button @click="togglePartyReady" class="btn-ready-sm" :class="{ 'is-ready': partyMembers[joinedParty.sessionId]?.ready }">
                        {{ partyMembers[joinedParty.sessionId]?.ready ? 'Ready' : 'Not Ready' }}
                    </button>
                    <button v-if="partyMembers[joinedParty.sessionId]?.isLeader" @click="startPartyGame" class="btn-primary">
                        Find Game for Party
                    </button>
                </div>
            </div>
            
            <div v-else class="party-setup">
                <button @click="createParty" class="btn-primary">+ Create Party</button>
                <div class="join-party-form">
                    <input v-model="inviteToJoin" placeholder="Enter Invite Code..." @keyup.enter="joinParty" />
                    <button @click="joinParty" class="btn-join-sm">Join Party</button>
                </div>
            </div>
        </div>

        <div class="browser-header">
          <h2>Available Rooms</h2>
          <button 
            @click="createRoom" 
            class="btn-primary" 
            v-if="!isCreating && (!joinedParty || (joinedParty && isPartyLeader()))"
            :disabled="joinedParty && !isPartyLeader()"
            :title="joinedParty && !isPartyLeader() ? 'Only party leaders can create rooms' : ''"
          >
            + Create Room
          </button>
        </div>

        <div v-if="isLoading" class="loader">
          <div class="spinner"></div>
          Scanning for signals...
        </div>

        <div v-else-if="rooms.length === 0" class="empty-state">
          <p>No active battlegrounds found.</p>
          <button @click="isCreating = true" class="btn-link">Be the first to create one</button>
        </div>

        <ul v-else class="room-list">
          <li v-for="room in rooms" :key="room.roomId" class="room-item">
            <div class="room-info">
              <span class="room-name">{{ room.metadata?.name || 'Unnamed Room' }}</span>
              <span class="room-id">{{ room.roomId }}</span>
            </div>
            <div class="room-stats">
              <span class="player-count">{{ room.clients }} / {{ room.maxClients }}</span>
              <button 
                @click="joinRoom(room.roomId)" 
                class="btn-join"
                :disabled="room.clients >= room.maxClients || (joinedParty && !isPartyLeader())"
                :title="joinedParty && !isPartyLeader() ? 'Only party leaders can join' : ''"
              >
                Join
              </button>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lobby-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at top left, #1a1a2e, #16213e);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  color: #fff;
}

.lobby-card {
  width: 100%;
  max-width: 500px;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  padding: 40px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  animation: fadeIn 0.6s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

header {
  text-align: center;
  margin-bottom: 32px;
}

h1 {
  font-size: 2.5rem;
  font-weight: 800;
  margin: 0;
  background: linear-gradient(135deg, #00d2ff 0%, #3a7bd5 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: -1px;
}

.subtitle {
  color: #94a3b8;
  font-size: 1rem;
  margin-top: 4px;
}

.browser-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

h2 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
}

.btn-primary {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary:hover {
  background: #2563eb;
  transform: translateY(-1px);
}

.create-form {
  background: rgba(255, 255, 255, 0.05);
  padding: 20px;
  border-radius: 16px;
  margin-bottom: 20px;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from { opacity: 0; scale: 0.95; }
  to { opacity: 1; scale: 1; }
}

input {
  width: 100%;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 12px;
  color: white;
  margin-bottom: 12px;
  outline: none;
}

input:focus {
  border-color: #3b82f6;
}

.form-actions {
  display: flex;
  gap: 8px;
}

.btn-success {
  background: #10b981;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}

.btn-ghost {
  background: transparent;
  color: #94a3b8;
  border: 1px solid #334155;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
}

.room-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 300px;
  overflow-y: auto;
}

.room-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 16px;
  margin-bottom: 12px;
  transition: background 0.2s;
}

.room-item:hover {
  background: rgba(255, 255, 255, 0.07);
}

.room-info {
  display: flex;
  flex-direction: column;
}

.room-name {
  font-weight: 600;
  font-size: 1rem;
}

.room-id {
  font-size: 0.75rem;
  color: #64748b;
  font-family: monospace;
}

.room-stats {
  display: flex;
  align-items: center;
  gap: 16px;
}

.player-count {
  font-size: 0.875rem;
  color: #94a3b8;
}

.btn-join {
  background: rgba(59, 130, 246, 0.1);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.2);
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-join:hover:not(:disabled) {
  background: #3b82f6;
  color: white;
}

.btn-join:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loader {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 30px;
  color: #94a3b8;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #64748b;
}

.btn-link {
  background: none;
  border: none;
  color: #3b82f6;
  cursor: pointer;
  font-weight: 600;
  text-decoration: underline;
}

.error-banner {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #f87171;
  padding: 12px 16px;
  border-radius: 12px;
  margin-bottom: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.close-btn {
  background: none;
  border: none;
  color: currentColor;
  font-size: 1.25rem;
  cursor: pointer;
}

/* Ready Room Styles */
.ready-room {
    animation: fadeIn 0.4s ease-out;
}

.ready-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
}

.room-title .label {
    font-size: 0.75rem;
    text-transform: uppercase;
    color: #64748b;
    font-weight: 700;
    letter-spacing: 0.1em;
}

.room-title h2 {
    margin: 0;
    font-size: 1.5rem;
    color: #3b82f6;
}

.players-list {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 16px;
    padding: 8px;
    margin-bottom: 32px;
}

.player-ready-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.player-ready-item:last-child {
    border-bottom: none;
}

.ready-status {
    font-size: 0.75rem;
    font-weight: 700;
    padding: 4px 10px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.05);
    color: #94a3b8;
}

.ready-status.is-ready {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
}

.ready-actions {
    text-align: center;
}

.btn-ready {
    width: 100%;
    padding: 16px;
    border-radius: 12px;
    border: none;
    background: rgba(255, 255, 255, 0.1);
    color: white;
    font-size: 1.1rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s;
}

.btn-ready.is-ready {
    background: #10b981;
    box-shadow: 0 0 20px rgba(16, 185, 129, 0.3);
}

.waiting-hint {
    margin-top: 16px;
    font-size: 0.875rem;
    color: #64748b;
}

.countdown-timer {
    margin-top: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    animation: pulse 1s infinite alternate;
}

.countdown-label {
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #fca5a5;
    font-weight: 600;
}

.countdown-value {
    font-size: 3rem;
    font-weight: 800;
    color: #ef4444;
    text-shadow: 0 0 15px rgba(239, 68, 68, 0.4);
}

@keyframes pulse {
    from { transform: scale(1); opacity: 0.8; }
    to { transform: scale(1.05); opacity: 1; }
}

/* Party System Styles */
.party-section {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 20px;
    padding: 24px;
    margin-bottom: 32px;
    border: 1px solid rgba(59, 130, 246, 0.2);
}

.party-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}

.party-header h3 {
    margin: 0;
    font-size: 1.1rem;
    color: #94a3b8;
}

.invite-code {
    background: #3b82f6;
    color: white;
    padding: 4px 12px;
    border-radius: 6px;
    font-family: monospace;
    font-size: 1.2rem;
    margin-left: 8px;
    box-shadow: 0 0 10px rgba(59, 130, 246, 0.4);
}

.party-members-list {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 24px;
}

.party-member {
    background: rgba(0, 0, 0, 0.3);
    padding: 8px 16px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    border: 1px solid rgba(255, 255, 255, 0.05);
}

.member-name {
    font-size: 0.875rem;
    font-weight: 500;
}

.leader-badge {
    font-size: 0.7rem;
    background: #f59e0b;
    color: #000;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 800;
    margin-left: 6px;
}

.ready-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #64748b;
}

.ready-dot.is-ready {
    background: #10b981;
    box-shadow: 0 0 8px #10b981;
}

.party-actions {
    display: flex;
    gap: 12px;
}

.btn-ready-sm {
    background: rgba(255, 255, 255, 0.1);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 8px 20px;
    border-radius: 10px;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.2s;
}

.btn-ready-sm.is-ready {
    background: #10b981;
    border-color: #10b981;
}

.party-setup {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.join-party-form {
    display: flex;
    gap: 8px;
}

.join-party-form input {
    margin-bottom: 0;
    flex: 1;
}

.btn-join-sm {
    background: #334155;
    color: white;
    border: none;
    padding: 0 20px;
    border-radius: 10px;
    cursor: pointer;
    font-weight: 600;
}

.btn-sm {
    padding: 4px 12px;
    font-size: 0.8rem;
}

</style>

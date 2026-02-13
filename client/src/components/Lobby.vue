<script setup>
import { ref, onMounted, onUnmounted, shallowRef, computed, watch } from 'vue';
import * as Colyseus from "@colyseus/sdk";
import { 
  GREEK_LETTERS, 
  copyPartyCode, 
  pastePartyCode, 
  playerJoinsParty, 
  fetchRooms, 
  isPartyLeader as checkIfLeader,
  createGameRoom,
  joinGameRoom,
  createPartyRoom,
  startPartyBattle
} from '../scripts/lobby.js';
// import { MyRoomState } from '../schema/MyRoomState.js';
// import { PartyState } from '../schema/PartyState.js';

const props = defineProps(['client', 'party', 'partyMembers', 'partyCode', 'room']);
const emit = defineEmits(['roomJoined', 'partyJoined', 'partyLeft']);

const rooms = ref([]);
const isCreating = ref(false);
const newRoomName = ref('');
const errorMessage = ref('');
const isLoading = ref(true);
const joinedRoom = computed(() => props.room);
const copySuccess = ref(false);
const inviteToJoin = ref('');
const currentRoomName = ref('Initialising...');
const currentCountdown = ref(0);
const connectedPlayers = ref({});

// If initialParty/Room exists, we need to sync logic
onMounted(() => {
  if (props.party) {
    handlePartyJoined(props.party);
  }
  if (props.room) {
    setupRoomListeners(props.room);
  }
});

watch(() => props.room, (newRoom) => {
  if (newRoom) {
    setupRoomListeners(newRoom);
  }
});

const setupRoomListeners = (room) => {
  if (!room) return;
  console.log("Lobby: Setting up listeners for room", room.id);

  room.onStateChange((state) => {
    currentRoomName.value = state.roomName || 'Lobby';
    currentCountdown.value = state.countdown || 0;

    const p = {};
    state.players.forEach((player, id) => {
      p[id] = { ready: player.ready };
    });
    connectedPlayers.value = p;
  });
};

const toggleReady = () => {
  if (props.room) {
    props.room.send("ready");
  }
};

const leaveJoinedRoom = () => {
  // If we are in a battle, App.vue handles the signaling.
  // If we are in the Lobby (props.room exists), we should also signal if lead.
  const isLeader = props.party && props.partyMembers[props.party.sessionId]?.isLeader;

  if (isLeader && props.party) {
    console.log("Lobby: Leader leaving pre-battle - Signaling party");
    props.party.send("leaveGame");
  }

  if (props.room) {
    props.room.leave();
  }
};

const fetchRoomsLocal = async () => {
  try {
    rooms.value = await fetchRooms(props.client);
  } catch (e) {
    // Errors handled in abstracted function
  } finally {
    isLoading.value = false;
  }
};

let refreshInterval;

onMounted(() => {
  fetchRoomsLocal();
  refreshInterval = setInterval(fetchRoomsLocal, 3000);
});

onUnmounted(() => {
  clearInterval(refreshInterval);
});

const isPartyLeader = () => checkIfLeader(props.party, props.partyMembers);

const createRoom = async () => {
  console.log("createRoom called. Party:", (props.party?.id || props.party?.roomId), "Is Leader:", isPartyLeader());

  if (props.party && !isPartyLeader()) {
    console.warn("Block: Non-leader attempted room creation");
    errorMessage.value = "Only the party leader can create a room.";
    return;
  }

  let roomName = newRoomName.value || GREEK_LETTERS[Math.floor(Math.random() * GREEK_LETTERS.length)];

  try {
    const room = await createGameRoom(props.client, props.party, { name: roomName });
    emit('roomJoined', room);

    if (isPartyLeader()) {
      props.party.send("startGame", { roomId: (room.id || room.roomId) });
    }
  } catch (e) {
    errorMessage.value = "Failed to create room: " + e.message;
  }
};

const joinRoom = async (roomId, options = {}) => {
  console.log("joinRoom called for", roomId, "Party:", (props.party?.id || props.party?.roomId), "Is Leader:", isPartyLeader());

  if (props.party && !isPartyLeader() && !options.partyId) {
    console.warn("Block: Non-leader attempted manual join");
    errorMessage.value = "Only the party leader can join a room manually.";
    return;
  }

  try {
    const room = await joinGameRoom(props.client, roomId, props.party, options);
    emit('roomJoined', room);

    if (isPartyLeader()) {
      props.party.send("startGame", { roomId: (room.id || room.roomId) });
    }
  } catch (e) {
    errorMessage.value = "Failed to join room: " + e.message;
  }
};

const createParty = async () => {
  try {
    const room = await createPartyRoom(props.client);
    handlePartyJoined(room);
  } catch (e) {
    errorMessage.value = "Failed to create party: " + e.message;
  }
};

const copyParty = async () => {
  copySuccess.value = await copyPartyCode(props.partyCode, errorMessage);
  setTimeout(() => copySuccess.value = false, 2000);
}

const pasteParty = async () => {
  inviteToJoin.value = await pastePartyCode(errorMessage);
}

const joinParty = async () => {
  await playerJoinsParty(inviteToJoin.value, errorMessage, props.client, handlePartyJoined);
};

const handlePartyJoined = (room) => {
  emit('partyJoined', room);
};

const leaveParty = () => {
  if (props.party) {
    props.party.leave();
    emit('partyLeft');
  }
};

const startPartyGame = async () => {
  if (props.party) {
    errorMessage.value = "Finding game room for party...";
    try {
      await startPartyBattle(props.client, joinRoom, createRoom);
      errorMessage.value = "";
    } catch (e) {
      errorMessage.value = e.message;
    }
  }
};

const togglePartyReady = () => {
  if (props.party) {
    props.party.send("toggleReady");
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
          <button @click="toggleReady" class="btn-ready"
            :class="{ 'is-ready': connectedPlayers[joinedRoom.sessionId]?.ready }">
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
          <div v-if="party" class="joined-party">
            <div class="party-header">
              <h3>My Party:
                <div class="invite-container">
                  <code class="invite-code">{{ partyCode }}</code>
                  <button @click="copyParty" class="btn-copy" :class="{ 'is-copied': copySuccess }">
                    {{ copySuccess ? 'COPIED!' : 'COPY' }}
                  </button>
                </div>
              </h3>
              <button @click="leaveParty" class="btn-ghost btn-sm">Leave Party</button>
            </div>

            <div class="party-members-list">
              <div v-for="(member, id) in partyMembers" :key="id" class="party-member">
                <span class="member-name">
                  {{ id === party.sessionId ? 'You' : 'Member ' + id.substring(0, 4) }}
                  <span v-if="member.isLeader" class="leader-badge">Leader</span>
                </span>
                <span class="ready-dot" :class="{ 'is-ready': member.ready }"></span>
              </div>
            </div>

            <div class="party-actions">
              <button @click="togglePartyReady" class="btn-ready-sm"
                :class="{ 'is-ready': partyMembers[party.sessionId]?.ready }">
                {{ partyMembers[party.sessionId]?.ready ? 'Ready' : 'Not Ready' }}
              </button>
              <button v-if="partyMembers[party.sessionId]?.isLeader" @click="startPartyGame" class="btn-primary">
                Find Game for Party
              </button>
            </div>
          </div>

          <div v-else class="party-setup">
            <button @click="createParty" class="btn-primary">+ Create Party</button>
            <div class="join-party-form">
              <div class="input-with-paste">
                <input v-model="inviteToJoin" placeholder="Enter Party Code..." @keyup.enter="joinParty" />
                <button @click="pasteParty" class="btn-paste" title="Paste from clipboard">PASTE</button>
              </div>
              <button @click="joinParty" class="btn-join-sm">Join Party</button>
            </div>
          </div>
        </div>

        <div class="browser-header">
          <h2>Available Rooms</h2>
          <button @click="createRoom" class="btn-primary" v-if="!isCreating && (!party || (party && isPartyLeader()))"
            :disabled="party && !isPartyLeader()"
            :title="party && !isPartyLeader() ? 'Only party leaders can create rooms' : ''">
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
              <button @click="joinRoom(room.roomId)" class="btn-join"
                :disabled="room.clients >= room.maxClients || (party && !isPartyLeader())"
                :title="party && !isPartyLeader() ? 'Only party leaders can join' : ''">
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
  from {
    opacity: 0;
    transform: translateY(20px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
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
  from {
    opacity: 0;
    scale: 0.95;
  }

  to {
    opacity: 1;
    scale: 1;
  }
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
  to {
    transform: rotate(360deg);
  }
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
  from {
    transform: scale(1);
    opacity: 0.8;
  }

  to {
    transform: scale(1.05);
    opacity: 1;
  }
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

.invite-container {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: 8px;
}

.invite-code {
  background: #098242;
  color: white;
  padding: 4px 12px;
  border-radius: 6px;
  font-family: monospace;
  font-size: 2rem;
  box-shadow: 0 0 15px rgba(9, 130, 66, 0.4);
}

.btn-copy {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: white;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.btn-copy:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.4);
}

.btn-copy.is-copied {
  background: #098242;
  border-color: #098242;
  box-shadow: 0 0 10px rgba(9, 130, 66, 0.5);
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
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.input-with-paste {
  display: flex;
  flex: 1;
}

.btn-paste {
  background: #475569;
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-left: none;
  padding: 0 12px;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  border-top-right-radius: 8px;
  border-bottom-right-radius: 8px;
  transition: all 0.2s;
}

.btn-paste:hover {
  background: #64748b;
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

<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useLobbyStore } from '../stores/lobby.js';
import { storeToRefs } from 'pinia';

const lobbyStore = useLobbyStore();
const { 
  currentRoom,
  joinedParty,
  partyMembers,
  partyInviteCode,
  rooms,
  isCreating,
  newRoomName,
  errorMessage,
  isLoading,
  copySuccess,
  inviteToJoin
} = storeToRefs(lobbyStore);

const { 
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
} = lobbyStore;

const currentRoomName = ref('Initialising...');
const currentCountdown = ref(0);
const connectedPlayers = ref({});

// Sync with room state if it exists
const setupRoomListeners = (room) => {
  if (!room) return;
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

const totalParticipants = computed(() => Object.keys(connectedPlayers.value).length);


const now = ref(Date.now());

const formatElapsed = (startedAt) => {
  const secs = Math.floor((now.value - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
};

onMounted(() => {
  if (currentRoom.value) setupRoomListeners(currentRoom.value);
  fetchRooms();
  const refreshInterval = setInterval(fetchRooms, 3000);
  const tickInterval = setInterval(() => { now.value = Date.now(); }, 1000);
  onUnmounted(() => {
    clearInterval(refreshInterval);
    clearInterval(tickInterval);
  });
});

watch(currentRoom, (newRoom) => {
  if (newRoom) setupRoomListeners(newRoom);
});

const toggleReady = () => {
  if (currentRoom.value) currentRoom.value.send("ready");
};

const createRoomHandler = async () => {
    if (joinedParty.value && !isPartyLeader()) {
        lobbyStore.errorMessage = "Only the party leader can create a room.";
        return;
    }
    await createGameRoom({ name: newRoomName.value });
};

const joinRoomHandler = async (roomId) => {
    if (joinedParty.value && !isPartyLeader()) {
        lobbyStore.errorMessage = "Only the party leader can join a room manually.";
        return;
    }
    await joinGameRoom(roomId);
};

</script>

<template>
  <div class="lobby-container">
    <div class="lobby-card">
      <header>
        <h1>Bomber League</h1>
        <p class="subtitle">Multiplayer Arena</p>
      </header>

      <div v-if="errorMessage" class="error-banner">
        {{ errorMessage }}
        <button @click="errorMessage = ''" class="close-btn">&times;</button>
      </div>

      <div v-if="currentRoom" class="ready-room">
        <div class="ready-header">
          <div class="room-title">
            <span class="label">Battleground:</span>
            <h2>{{ currentRoomName }}</h2>
          </div>
          <button @click="leaveBattle" class="btn-ghost">Leave</button>
        </div>

        <div class="players-list">
          <div v-for="(player, id) in connectedPlayers" :key="id" class="player-ready-item">
            <span class="player-name">
              {{ id === currentRoom.sessionId ? 'You' : 'Player ' + id.substring(0, 4) }}
            </span>
            <span class="ready-status" :class="{ 'is-ready': player.ready }">
              {{ player.ready ? 'READY' : 'WAITING' }}
            </span>
          </div>
        </div>

        <div class="ready-actions">

          <button @click="toggleReady" class="btn-ready"
            :class="{ 'is-ready': connectedPlayers[currentRoom.sessionId]?.ready }">
            {{ connectedPlayers[currentRoom.sessionId]?.ready ? 'I am Ready!' : 'Ready Up' }}
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
        <div class="party-unavailable-wrapper">
          <div class="party-unavailable-overlay">
            <span class="party-unavailable-icon">🚧</span>
            <span class="party-unavailable-text">Party Mode — Coming Soon</span>
          </div>
          <div class="party-section party-section--disabled">
            <div v-if="joinedParty" class="joined-party">
              <div class="party-info">
                <span class="party-label">Party Code:</span>
                <div class="party-code-box">
                  <code>{{ partyInviteCode }}</code>
                  <button @click="copyPartyCode" class="btn-icon" title="Copy Code" disabled>
                    <span v-if="copySuccess">✓</span>
                    <span v-else>📋</span>
                  </button>
                </div>
              </div>
              
              <div class="party-members-grid">
                <div v-for="(member, id) in partyMembers" :key="id" class="party-member-chip">
                  <span class="member-icon">{{ member.isLeader ? '👑' : '👤' }}</span>
                  <span class="member-name">{{ id === joinedParty.sessionId ? 'Me' : id.substring(0, 4) }}</span>
                  <span class="member-ready" :class="{ 'is-ready': member.ready }">•</span>
                </div>
              </div>

              <div class="party-footer">
                <button v-if="isPartyLeader()" class="btn-primary start-btn" disabled>
                  Find Game for Party
                </button>
                <button v-else class="btn-ready-small" disabled>
                  Ready Up
                </button>
                <button class="btn-leave-party" disabled>Leave Party</button>
              </div>
            </div>

            <div v-else class="no-party">
              <button class="btn-secondary" disabled>Create Party</button>
              <div class="join-party-form">
                <input placeholder="Invite Code" disabled />
                <button class="btn-paste" disabled>Paste</button>
                <button class="btn-join" disabled>Join</button>
              </div>
            </div>
          </div>
        </div>

        <div class="divider"><span>OR</span></div>

        <!-- Room List Section -->
        <div class="browser-controls">
          <button @click="isCreating = !isCreating" class="btn-primary">
            {{ isCreating ? 'Cancel' : 'Create New Game' }}
          </button>
          
          <div v-if="isCreating" class="create-form">
            <input v-model="newRoomName" placeholder="Battleground Name (optional)" />
            <button @click="createRoomHandler" class="btn-create">Initialize</button>
          </div>
        </div>

        <div class="rooms-container">
          <div v-if="isLoading" class="loader">Scanning for active battles...</div>
          <div v-else-if="rooms.length === 0" class="empty-rooms">
            <p>No active battlegrounds found.</p>
          </div>
          <div v-else class="rooms-grid">
            <div v-for="room in rooms" :key="room.roomId" class="room-item">
              <div class="room-meta">
                <h3>{{ room.metadata?.name || 'Unnamed Zone' }}</h3>
                <div class="room-stats">
                  <span class="room-stat players-stat">
                    <span class="stat-icon">👥</span> {{ room.clients }} {{ room.clients === 1 ? 'player' : 'players' }}
                  </span>
                  <span v-if="room.metadata?.gameStarted && room.metadata?.gameStartedAt" class="room-stat running-stat">
                    <span class="stat-icon">⏱</span> {{ formatElapsed(room.metadata.gameStartedAt) }}
                  </span>
                  <span v-else class="room-stat lobby-stat">
                    <span class="stat-icon">🟡</span> Lobby
                  </span>
                </div>
              </div>
              <button @click="joinRoomHandler(room.roomId)" class="btn-join-room">Engage</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lobby-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: radial-gradient(circle at center, #1e293b 0%, #0f172a 100%);
  padding: 20px;
}

.lobby-card {
  width: 100%;
  max-width: 500px;
  background: rgba(30, 41, 59, 0.7);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  padding: 40px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

header {
  text-align: center;
  margin-bottom: 40px;
}

h1 {
  font-size: 2.5rem;
  font-weight: 800;
  margin: 0;
  background: linear-gradient(135deg, #fff 0%, #94a3b8 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: -0.02em;
}

.subtitle {
  color: #64748b;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 0.875rem;
  margin-top: 8px;
}

.error-banner {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #f87171;
  padding: 12px 16px;
  border-radius: 12px;
  margin-bottom: 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.875rem;
}

.close-btn {
  background: none;
  border: none;
  color: currentColor;
  cursor: pointer;
  font-size: 1.25rem;
}

.btn-primary {
  width: 100%;
  background: #3b82f6;
  color: white;
  border: none;
  padding: 14px;
  border-radius: 12px;
  font-weight: 600;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.3);
}

.btn-primary:hover {
  background: #2563eb;
  transform: translateY(-1px);
}

.ready-room {
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.ready-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32px;
}

.label {
  color: #64748b;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

h2 {
  font-size: 1.5rem;
  margin: 4px 0 0 0;
  color: #f1f5f9;
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #94a3b8;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 0.875rem;
  cursor: pointer;
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
  padding: 12px 16px;
  border-radius: 8px;
}

.player-name {
  color: #cbd5e1;
  font-weight: 500;
}

.ready-status {
  font-size: 0.75rem;
  font-weight: 800;
  color: #475569;
}

.ready-status.is-ready {
  color: #10b981;
}

.btn-ready {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid #3b82f6;
  color: #3b82f6;
  padding: 16px;
  border-radius: 12px;
  font-weight: 700;
  font-size: 1.125rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-ready.is-ready {
  background: #10b981;
  border-color: #10b981;
  color: white;
}

.countdown-timer {
  margin-top: 24px;
  text-align: center;
}

.countdown-label {
  display: block;
  color: #64748b;
  font-size: 0.875rem;
}

.countdown-value {
  font-size: 3rem;
  font-weight: 800;
  color: #3b82f6;
}

.waiting-hint {
  text-align: center;
  color: #475569;
  font-size: 0.875rem;
  margin-top: 16px;
}

/* Room Browser Styles */
.party-unavailable-wrapper {
  position: relative;
  margin-bottom: 32px;
}

.party-unavailable-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(3px);
  border-radius: 16px;
  border: 1px dashed rgba(255, 255, 255, 0.15);
}

.party-unavailable-icon {
  font-size: 1.5rem;
}

.party-unavailable-text {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #64748b;
}

.party-section {
  margin-bottom: 0;
}

.party-section--disabled {
  opacity: 0.35;
  pointer-events: none;
  user-select: none;
}

.no-party {
  display: flex;
  flex-direction: column;
  gap: 16px;
}


.participant-progress {
  margin-top: 24px;
}

.progress-track {
  height: 6px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-bar {
  height: 100%;
  background: #3b82f6;
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.progress-text {
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 14px;
  border-radius: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.2);
}

.join-party-form {
  display: flex;
  gap: 8px;
}

input {
  flex: 1;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 10px 14px;
  color: white;
  font-family: inherit;
}

.btn-join {
  background: #1e293b;
  border: 1px solid #3b82f6;
  color: #3b82f6;
  padding: 0 20px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}

.joined-party {
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 16px;
  padding: 20px;
}

.party-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.party-code-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0,0,0,0.3);
  padding: 4px 12px;
  border-radius: 8px;
}

code {
  font-family: monospace;
  font-weight: 700;
  color: #60a5fa;
  font-size: 1.1rem;
}

.party-members-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}

.party-member-chip {
  background: rgba(0,0,0,0.2);
  border-radius: 20px;
  padding: 4px 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
}

.member-ready {
    color: #475569;
    font-size: 1.5rem;
}
.member-ready.is-ready {
    color: #10b981;
}

.party-footer {
  display: flex;
  gap: 8px;
}

.btn-leave-party {
  background: none;
  border: none;
  color: #64748b;
  font-size: 0.8rem;
  text-decoration: underline;
  cursor: pointer;
}

.divider {
  display: flex;
  align-items: center;
  margin: 32px 0;
  color: #334155;
}

.divider::before, .divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: currentColor;
}

.divider span {
  padding: 0 16px;
  font-size: 0.75rem;
  font-weight: 800;
}

.rooms-container {
  margin-top: 24px;
  max-height: 300px;
  overflow-y: auto;
}

.rooms-grid {
  display: grid;
  gap: 12px;
}

.room-item {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.room-meta h3 {
  margin: 0;
  font-size: 1rem;
  color: #e2e8f0;
}

.room-stats {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.room-stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 20px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.stat-icon {
  font-size: 0.75rem;
}

.players-stat {
  background: rgba(99, 102, 241, 0.15);
  color: #a5b4fc;
}

.running-stat {
  background: rgba(16, 185, 129, 0.15);
  color: #6ee7b7;
}

.lobby-stat {
  background: rgba(234, 179, 8, 0.15);
  color: #fde047;
}

.btn-join-room {
  background: #334155;
  color: #f1f5f9;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.875rem;
  cursor: pointer;
}

.btn-join-room:hover {
  background: #475569;
}

.create-form {
  margin-top: 16px;
  display: flex;
  gap: 8px;
}

.btn-create {
  background: #10b981;
  color: white;
  border: none;
  padding: 0 16px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}

.btn-paste {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    color: #94a3b8;
    padding: 0 10px;
    border-radius: 8px;
    font-size: 0.8rem;
    cursor: pointer;
}

.btn-ready-small {
    flex: 1;
    background: #1e293b;
    border: 1px solid #3b82f6;
    color: #3b82f6;
    border-radius: 8px;
    padding: 8px;
    font-weight: 600;
    cursor: pointer;
}
.btn-ready-small.ready-go {
    background: #10b981;
    border-color: #10b981;
    color: white;
}
</style>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import * as Colyseus from "@colyseus/sdk";
import { MyRoomState } from '../schema/MyRoomState.js';

const client = new Colyseus.Client('ws://localhost:2567');
const rooms = ref([]);
const isCreating = ref(false);
const newRoomName = ref('');
const errorMessage = ref('');
const isLoading = ref(true);

const emit = defineEmits(['joined']);

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

const createRoom = async () => {
  let roomName = newRoomName.value;
  if (!roomName) {
    roomName = greekLetters[Math.floor(Math.random() * greekLetters.length)];
  }
  
  try {
    const room = await client.create("my_room", { name: roomName }, MyRoomState);
    emit('joined', room);
  } catch (e) {
    errorMessage.value = "Failed to create room: " + e.message;
  }
};

const joinRoom = async (roomId) => {
  try {
    const room = await client.joinById(roomId, {}, MyRoomState);
    emit('joined', room);
  } catch (e) {
    errorMessage.value = "Failed to join room: " + e.message;
  }
};
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

      <div class="room-browser">
        <div class="browser-header">
          <h2>Available Rooms</h2>
          <button @click="isCreating = true" class="btn-primary" v-if="!isCreating">
            + Create Room
          </button>
        </div>

        <div v-if="isCreating" class="create-form">
          <input 
            v-model="newRoomName" 
            placeholder="Room Name..." 
            @keyup.enter="createRoom"
            autofocus
          />
          <div class="form-actions">
            <button @click="createRoom" class="btn-success">Confirm</button>
            <button @click="isCreating = false" class="btn-ghost">Cancel</button>
          </div>
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
                :disabled="room.clients >= room.maxClients"
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
</style>

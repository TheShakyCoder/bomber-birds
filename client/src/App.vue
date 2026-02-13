<script setup>
import Lobby from './components/Lobby.vue'
import GameView from './components/GameView.vue'
import { useLobbyStore } from './stores/lobby.js';
import { storeToRefs } from 'pinia';

const lobbyStore = useLobbyStore();
const { 
  currentRoom,
  gameStarted,
  joinedParty
} = storeToRefs(lobbyStore);

const { leaveBattle } = lobbyStore;
</script>

<template>
  <main>
    <Lobby 
        v-if="!gameStarted" 
    />
    
    <div v-else class="game-container">
      <div class="game-hud">
        <div class="room-info">
          <span class="room-label">Battleground:</span>
          <span class="room-id">{{ currentRoom.state?.roomName || currentRoom.id }}</span>
        </div>
        <button @click="leaveBattle" class="btn-leave">Leave Battle</button>
      </div>
      
      <GameView :room="currentRoom" :party="joinedParty" @leave="leaveBattle" />
    </div>
  </main>
</template>

<style>
:root {
  background: #0f172a;
  color: white;
}

body {
  margin: 0;
  overflow: hidden;
}

main {
  width: 100vw;
  height: 100vh;
}

.game-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.game-hud {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 10;
}

.room-info {
  display: flex;
  gap: 8px;
  align-items: center;
}

.room-label {
  color: #64748b;
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.room-id {
  font-family: monospace;
  color: #3b82f6;
  font-weight: 700;
}

.btn-leave {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.2);
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-leave:hover {
  background: #ef4444;
  color: white;
}

.game-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #1e293b;
  position: relative;
}

.bento-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 40px;
}

.bento-item {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 12px 24px;
  border-radius: 12px;
  font-size: 0.875rem;
  font-weight: 500;
  color: #94a3b8;
}

h2 {
  font-size: 2rem;
  margin-bottom: 1rem;
  background: linear-gradient(135deg, #fff 0%, #94a3b8 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.game-placeholder p {
  color: #64748b;
}
</style>

<script setup>
import { onMounted, onUnmounted, ref, computed } from 'vue';
import * as BABYLON from '@babylonjs/core';
import "@babylonjs/materials";

const props = defineProps({
  room: Object
});

const emit = defineEmits(['leave']);

const canvasRef = ref(null);
const winnerName = ref(null);
let engine, scene, camera;
const meshes = new Map(); // id -> Mesh
const playerMeshes = new Map(); // sessionId -> Mesh

// Reactive state for UI logic
const playersData = ref({});
const syncTimeoutReached = ref(false);

const totalPlayers = computed(() => Object.keys(playersData.value).length || 0);
const loadedPlayers = computed(() => {
    let count = 0;
    Object.values(playersData.value).forEach(p => {
        if (p.loaded) count++;
    });
    return count;
});

const isSyncing = computed(() => {
    if (syncTimeoutReached.value) return false;
    return loadedPlayers.value < totalPlayers.value;
});

onMounted(() => {
  initBabylon();
  setupRoomListeners();
  
  // Signal that our GUI is ready
  console.log("GameView: Sending guiLoaded signal");
  props.room.send("guiLoaded");

  // Safety Timeout: 10 seconds to sync or we force start
  setTimeout(() => {
    if (isSyncing.value) {
        console.warn("Sync timeout reached. Forcing game start UI.");
        syncTimeoutReached.value = true;
    }
  }, 10000);
});

onUnmounted(() => {
  engine?.dispose();
  window.removeEventListener('keydown', handleKeyDown);
});

const initBabylon = () => {
  engine = new BABYLON.Engine(canvasRef.value, true);
  scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.05, 0.05, 0.1, 1);

  camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3, 20, new BABYLON.Vector3(7, 0, 7), scene);
  camera.attachControl(canvasRef.value, true);

  // Disable rotation but keep zoom
  camera.lowerAlphaLimit = camera.alpha;
  camera.upperAlphaLimit = camera.alpha;
  camera.lowerBetaLimit = camera.beta;
  camera.upperBetaLimit = camera.beta;
  
  // Zoom settings
  camera.lowerRadiusLimit = 5;
  camera.upperRadiusLimit = 30;

  const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
  light.intensity = 0.7;

  const pointLight = new BABYLON.PointLight("pointLight", new BABYLON.Vector3(7, 10, 7), scene);
  pointLight.intensity = 0.5;

  engine.runRenderLoop(() => {
    scene.render();
  });

  window.addEventListener('resize', () => engine.resize());
  window.addEventListener('keydown', handleKeyDown);
};

const setupRoomListeners = () => {
  const room = props.room;
  if (!room || !room.state) return;

  const seenGrid = new Set();
  const seenPlayers = new Set();
  const seenBombs = new Set();

  room.onStateChange((state) => {
    if (state.winnerId) {
      winnerName.value = state.winnerId === room.sessionId ? 'YOU' : 'Another Player';
    }

    // Manual sync for Grid
    if (state.grid) {
      state.grid.forEach((block, key) => {
        if (!seenGrid.has(key)) {
          seenGrid.add(key);
          const [x, z] = key.split(',').map(Number);
          createBlockMesh(x, z, block.type, key);
        }
      });
      // Cleanup grid (if blocks can be removed)
      for (const key of seenGrid) {
        if (!state.grid.has(key)) {
          seenGrid.delete(key);
          const mesh = meshes.get(key);
          if (mesh) { mesh.dispose(); meshes.delete(key); }
        }
      }
    }

    // Manual sync for Players
    if (state.players) {
      const pData = {};
      state.players.forEach((player, sessionId) => {
        // Update reactive data for HUD and Loading Screen
        pData[sessionId] = { 
            health: player.health, 
            alive: player.alive, 
            loaded: player.loaded,
            team: player.team
        };

        if (!seenPlayers.has(sessionId)) {
          seenPlayers.add(sessionId);
          createPlayerMesh(sessionId, player);
        }
        
        // Pull-based sync: Update mesh every state change
        const mesh = playerMeshes.get(sessionId);
        if (mesh) {
          mesh.position.x = player.x;
          mesh.position.z = player.z;
          mesh.isVisible = player.alive;
        }
      });
      playersData.value = pData;

      // Cleanup players
      for (const sessionId of seenPlayers) {
        if (!state.players.has(sessionId)) {
          seenPlayers.delete(sessionId);
          const mesh = playerMeshes.get(sessionId);
          if (mesh) { mesh.dispose(); playerMeshes.delete(sessionId); }
        }
      }
    }

    // Manual sync for Bombs
    if (state.bombs) {
      state.bombs.forEach((bomb, key) => {
        if (!seenBombs.has(key)) {
          seenBombs.add(key);
          createBombMesh(bomb.x, bomb.z, key);
        }
      });
      for (const key of seenBombs) {
        if (!state.bombs.has(key)) {
          seenBombs.delete(key);
          const mesh = meshes.get(`bomb_${key}`);
          if (mesh) { mesh.dispose(); meshes.delete(`bomb_${key}`); }
        }
      }
    }
  });
};

const createBlockMesh = (x, z, type, key) => {
  const mesh = BABYLON.MeshBuilder.CreateBox(`block_${key}`, { size: 0.95 }, scene);
  mesh.position.set(x, 0.5, z);
  
  const mat = new BABYLON.StandardMaterial(`mat_${key}`, scene);
  if (type === "indestructible") {
    mat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    mat.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  } else {
    mat.diffuseColor = new BABYLON.Color3(0.6, 0.4, 0.2);
  }
  mesh.material = mat;
  meshes.set(key, mesh);
};

const createBombMesh = (x, z, key) => {
  const mesh = BABYLON.MeshBuilder.CreateSphere(`bomb_${key}`, { diameter: 0.7 }, scene);
  mesh.position.set(x, 0.5, z);

  const mat = new BABYLON.StandardMaterial(`bombMat_${key}`, scene);
  mat.diffuseColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  mat.emissiveColor = new BABYLON.Color3(0.5, 0, 0); // Pulsing effect would be nice
  mesh.material = mat;

  meshes.set(`bomb_${key}`, mesh);
};

const createPlayerMesh = (sessionId, player) => {
  const isMe = sessionId === props.room.sessionId;
  const mesh = BABYLON.MeshBuilder.CreateSphere(`player_${sessionId}`, { diameter: 0.8 }, scene);
  mesh.position.set(player.x, 0.5, player.z);

  const mat = new BABYLON.StandardMaterial(`playerMat_${sessionId}`, scene);
  mat.diffuseColor = isMe ? new BABYLON.Color3(0, 0.8, 1) : new BABYLON.Color3(1, 0.2, 0.2);
  mesh.material = mat;

  playerMeshes.set(sessionId, mesh);

  // Center camera on local player and apply team-based rotation
  if (isMe) {
    camera.lockedTarget = mesh;
    
    // Set fixed rotation based on team so spawn is always bottom-left
    let alpha = -Math.PI / 2; // Team 0 Default
    if (player.team === 1) alpha = Math.PI / 2;
    if (player.team === 2) alpha = Math.PI;
    if (player.team === 3) alpha = 0;

    camera.alpha = alpha;
    camera.beta = Math.PI / 4;
    camera.radius = 12;

    // Lock rotation at this team-specific angle
    camera.lowerAlphaLimit = alpha;
    camera.upperAlphaLimit = alpha;
    camera.lowerBetaLimit = camera.beta;
    camera.upperBetaLimit = camera.beta;
  }
};

const handleKeyDown = (e) => {
  const myPlayer = playersData.value[props.room.sessionId];
  if (!myPlayer) return;

  let move = null;
  const team = myPlayer.team;

  // Remap keys based on team rotation (Bottom-Left perspective)
  switch (e.key) {
    case 'ArrowUp': case 'w': 
        if (team === 0) move = { dx: 0, dz: 1 };
        else if (team === 1) move = { dx: 0, dz: -1 };
        else if (team === 2) move = { dx: 1, dz: 0 };
        else if (team === 3) move = { dx: -1, dz: 0 };
        break;
    case 'ArrowDown': case 's': 
        if (team === 0) move = { dx: 0, dz: -1 };
        else if (team === 1) move = { dx: 0, dz: 1 };
        else if (team === 2) move = { dx: -1, dz: 0 };
        else if (team === 3) move = { dx: 1, dz: 0 };
        break;
    case 'ArrowLeft': case 'a': 
        if (team === 0) move = { dx: -1, dz: 0 };
        else if (team === 1) move = { dx: 1, dz: 0 };
        else if (team === 2) move = { dx: 0, dz: 1 };
        else if (team === 3) move = { dx: 0, dz: -1 };
        break;
    case 'ArrowRight': case 'd': 
        if (team === 0) move = { dx: 1, dz: 0 };
        else if (team === 1) move = { dx: -1, dz: 0 };
        else if (team === 2) move = { dx: 0, dz: -1 };
        else if (team === 3) move = { dx: 0, dz: 1 };
        break;
    case ' ': props.room.send("placeBomb"); break;
  }

  if (move) {
    props.room.send("move", move);
  }
};
</script>

<template>
  <div class="game-view">
    <canvas ref="canvasRef"></canvas>
    
    <div class="hud-top-left">
      <div v-for="(player, id) in playersData" :key="id" class="player-stat" :class="{ 'is-me': id === props.room.sessionId, 'is-dead': !player.alive }">
        <span class="player-dot"></span>
        <span class="player-name">{{ id === props.room.sessionId ? 'You' : 'Player' }}</span>
        <div class="health-bar-bg">
          <div class="health-bar-fill" :style="{ width: player.health + '%' }"></div>
        </div>
      </div>
    </div>

    <div v-if="winnerName" class="victory-overlay">
        <div class="victory-card">
            <h2>🏆 VICTORY 🏆</h2>
            <p>{{ winnerName }} is the last standing!</p>
            <button @click="$emit('leave')" class="btn-primary">Leave Game</button>
        </div>
    </div>

    <div v-if="isSyncing && !winnerName" class="loading-overlay">
        <div class="loader-content">
            <div class="loading-spinner"></div>
            <h3>Synchronizing Arena</h3>
            <p>Waiting for all players to initialize...</p>
            <div class="sync-progress">
                <div class="progress-track">
                    <div class="progress-bar" :style="{ width: (loadedPlayers / totalPlayers * 100) + '%' }"></div>
                </div>
                <span class="progress-text">{{ loadedPlayers }} / {{ totalPlayers }} Players Ready</span>
            </div>
        </div>
    </div>

    <div class="controls-hint">
        WASD to Move | Space to Bomb
    </div>
  </div>
</template>

<style scoped>
.loading-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: radial-gradient(circle at center, #1a1a2e 0%, #0f0f1a 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
}

.loader-content {
    text-align: center;
    max-width: 300px;
    width: 100%;
}

.loading-spinner {
    width: 50px;
    height: 50px;
    border: 3px solid rgba(59, 130, 246, 0.1);
    border-top-color: #3b82f6;
    border-radius: 50%;
    margin: 0 auto 24px;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

.loader-content h3 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 8px;
    color: #fff;
}

.loader-content p {
    color: #94a3b8;
    font-size: 0.875rem;
    margin-bottom: 24px;
}

.sync-progress {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.progress-track {
    height: 4px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 2px;
    overflow: hidden;
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
    color: #60a5fa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.game-view {
  width: 100vw;
  height: 100vh;
  position: relative;
}

canvas {
  width: 100%;
  height: 100%;
  display: block;
  outline: none;
}

.hud-top-left {
    position: absolute;
    top: 20px;
    left: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    pointer-events: none;
}

.player-stat {
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
    padding: 8px 16px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    min-width: 160px;
}

.player-stat.is-me {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.1);
}

.player-stat.is-dead {
    opacity: 0.5;
    filter: grayscale(1);
}

.player-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ef4444;
}

.is-me .player-dot {
    background: #3b82f6;
}

.player-name {
    font-size: 0.875rem;
    font-weight: 600;
}

.health-bar-bg {
    flex: 1;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    overflow: hidden;
}

.health-bar-fill {
    height: 100%;
    background: #10b981;
    transition: width 0.3s ease;
}

.victory-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
    z-index: 100;
}

.victory-card {
    background: #1e293b;
    padding: 40px;
    border-radius: 24px;
    text-align: center;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 0 50px rgba(59, 130, 246, 0.3);
}

.victory-card h2 {
    font-size: 2.5rem;
    color: #f59e0b;
    margin-bottom: 20px;
}

.btn-primary {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 12px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 20px;
}

.controls-hint {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    padding: 10px 20px;
    border-radius: 20px;
    font-size: 0.875rem;
    color: #94a3b8;
    pointer-events: none;
    border: 1px solid rgba(255, 255, 255, 0.1);
}
</style>

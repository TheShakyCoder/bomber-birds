<script setup>
import { onMounted, onUnmounted, ref, computed } from 'vue';
import * as BABYLON from '@babylonjs/core';
import "@babylonjs/materials";

const props = defineProps(['room', 'party']);

const emit = defineEmits(['leave']);

const canvasRef = ref(null);
const winnerName = ref(null);
let engine, scene, camera;
const meshes = new Map(); // id -> Mesh
const playerMeshes = new Map(); // sessionId -> Mesh
let highlightLayer;

const TEAM_COLORS = [
  new BABYLON.Color3(1, 0.2, 0.2),   // Team 0: Red
  new BABYLON.Color3(0.2, 0.8, 0.2), // Team 1: Green
  new BABYLON.Color3(0.2, 0.5, 1.0), // Team 2: Blue
  new BABYLON.Color3(1.0, 0.9, 0.2)  // Team 3: Yellow
];

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

  highlightLayer = new BABYLON.HighlightLayer("hl1", scene);

  engine.runRenderLoop(() => {
    const lerpSpeed = 0.2; // Adjust for smoothness vs responsiveness
    const rotLerpSpeed = 0.15;

    playerMeshes.forEach((mesh, sessionId) => {
      if (mesh.targetPos) {
        // Calculate movement vector
        const dx = mesh.targetPos.x - mesh.position.x;
        const dz = mesh.targetPos.z - mesh.position.z;

        // Only rotate if there's significant movement
        if (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) {
          const targetRotation = Math.atan2(dx, dz);
          
          // Smooth rotation interpolation
          let diff = targetRotation - mesh.rotation.y;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          mesh.rotation.y += diff * rotLerpSpeed;
        }

        mesh.position.x = BABYLON.Scalar.Lerp(mesh.position.x, mesh.targetPos.x, lerpSpeed);
        mesh.position.z = BABYLON.Scalar.Lerp(mesh.position.z, mesh.targetPos.z, lerpSpeed);
      }
    });

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
  const seenBases = new Set();

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
          createBlockMesh(x, z, block.type, key, -1, false);
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

    // Manual sync for Bases
    if (state.bases) {
      state.bases.forEach((base, key) => {
        if (!seenBases.has(key)) {
          seenBases.add(key);
          const [x, z] = key.split(',').map(Number);
          createBlockMesh(x, z, "base", key, base.team, base.isTurret);
        }
      });
      // Cleanup bases
      for (const key of seenBases) {
        if (!state.bases.has(key)) {
          seenBases.delete(key);
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
            team: player.team,
            isBot: player.isBot
        };

        if (!seenPlayers.has(sessionId)) {
          seenPlayers.add(sessionId);
          createPlayerMesh(sessionId, player);
        }
        
        // Push target position to mesh for interpolation in render loop
        const mesh = playerMeshes.get(sessionId);
        if (mesh) {
          mesh.targetPos = { x: player.x, z: player.z };
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
          createBombMesh(bomb.x, bomb.z, key, bomb.team);
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

const createBlockMesh = (x, z, type, key, team, isTurret) => {
  let mesh;
  const mat = new BABYLON.StandardMaterial(`mat_${key}`, scene);
  const teamColor = TEAM_COLORS[team] || new BABYLON.Color3(0.5, 0.5, 0.5);

  if (isTurret) {
    // Castle Turret Base
    mesh = BABYLON.MeshBuilder.CreateBox(`block_${key}`, { size: 0.95 }, scene);
    mesh.position.set(x, 0.5, z);
    mat.diffuseColor = teamColor;
    mat.emissiveColor = teamColor.scale(0.2);
    mesh.material = mat;

    // Tower Structure
    const tower = BABYLON.MeshBuilder.CreateBox(`tower_${key}`, { width: 0.7, height: 1.5, depth: 0.7 }, scene);
    tower.parent = mesh;
    tower.position.y = 0.75; // Sit on base
    tower.material = mat;

    // Crenelations (Top teeth)
    const topFloor = BABYLON.MeshBuilder.CreateBox(`topFloor_${key}`, { width: 0.85, height: 0.2, depth: 0.85 }, scene);
    topFloor.parent = tower;
    topFloor.position.y = 0.85;
    topFloor.material = mat;

    // Small teeth blocks
    const toothSize = 0.15;
    const offsets = [
      {x: 0.35, z: 0.35}, {x: -0.35, z: 0.35}, {x: 0.35, z: -0.35}, {x: -0.35, z: -0.35}
    ];
    offsets.forEach((off, i) => {
      const tooth = BABYLON.MeshBuilder.CreateBox(`tooth_${key}_${i}`, { size: toothSize }, scene);
      tooth.parent = topFloor;
      tooth.position.set(off.x, 0.1, off.z);
      tooth.material = mat;
    });

  } else if (type === "indestructible") {
    mesh = BABYLON.MeshBuilder.CreateBox(`block_${key}`, { size: 0.95 }, scene);
    mesh.position.set(x, 0.5, z);
    mat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    mat.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    mesh.material = mat;
  } else if (type === "base") {
    mesh = BABYLON.MeshBuilder.CreateBox(`block_${key}`, { size: 0.95 }, scene);
    mesh.position.set(x, 0.05, z);
    mat.diffuseColor = teamColor;
    mat.alpha = 0.4; // Semi-transparent base floor-like block
    mesh.scaling.y = 0.1;   // Thin floor
    mesh.material = mat;
  } else {
    mesh = BABYLON.MeshBuilder.CreateBox(`block_${key}`, { size: 0.95 }, scene);
    mesh.position.set(x, 0.5, z);
    mat.diffuseColor = new BABYLON.Color3(0.6, 0.4, 0.2);
    mesh.material = mat;
  }
  
  meshes.set(key, mesh);
};

const createBombMesh = (x, z, key, team) => {
  const mesh = BABYLON.MeshBuilder.CreateSphere(`bomb_${key}`, { diameter: 0.7 }, scene);
  mesh.position.set(x, 0.5, z);

  const mat = new BABYLON.StandardMaterial(`bombMat_${key}`, scene);
  const teamColor = TEAM_COLORS[team] || new BABYLON.Color3(0.1, 0.1, 0.1);
  mat.diffuseColor = teamColor.scale(0.5);
  mat.emissiveColor = teamColor.scale(0.8);
  mesh.material = mat;

  meshes.set(`bomb_${key}`, mesh);
};

const createPlayerMesh = (sessionId, player) => {
  const isMe = sessionId === props.room.sessionId;
  
  // Create a parent node for the animal
  const mesh = new BABYLON.TransformNode(`player_${sessionId}`, scene);
  mesh.position.set(player.x, 0.5, player.z);
  mesh.targetPos = { x: player.x, z: player.z };

  const mat = new BABYLON.StandardMaterial(`playerMat_${sessionId}`, scene);
  const teamColor = TEAM_COLORS[player.team] || new BABYLON.Color3(1, 1, 1);
  mat.diffuseColor = teamColor;
  
  if (isMe) {
    mat.emissiveColor = teamColor.scale(0.3);
  }

  // Construct animal based on team
  let body;
  if (player.team === 0) { // Red -> Pig
    body = BABYLON.MeshBuilder.CreateBox("body", { width: 0.6, height: 0.5, depth: 0.8 }, scene);
    const head = BABYLON.MeshBuilder.CreateBox("head", { size: 0.4 }, scene);
    head.parent = body;
    head.position.z = 0.45;
    head.position.y = 0.1;
    const snout = BABYLON.MeshBuilder.CreateBox("snout", { width: 0.2, height: 0.15, depth: 0.1 }, scene);
    snout.parent = head;
    snout.position.z = 0.25;
  } else if (player.team === 1) { // Green -> Frog
    body = BABYLON.MeshBuilder.CreateBox("body", { width: 0.7, height: 0.4, depth: 0.6 }, scene);
    const eyeL = BABYLON.MeshBuilder.CreateSphere("eyeL", { diameter: 0.25 }, scene);
    eyeL.parent = body;
    eyeL.position.set(-0.25, 0.25, 0.2);
    const eyeR = BABYLON.MeshBuilder.CreateSphere("eyeR", { diameter: 0.25 }, scene);
    eyeR.parent = body;
    eyeR.position.set(0.25, 0.25, 0.2);
  } else if (player.team === 2) { // Blue -> Cat
    body = BABYLON.MeshBuilder.CreateBox("body", { width: 0.5, height: 0.5, depth: 0.7 }, scene);
    const head = BABYLON.MeshBuilder.CreateBox("head", { size: 0.4 }, scene);
    head.parent = body;
    head.position.z = 0.35;
    head.position.y = 0.1;
    const earL = BABYLON.MeshBuilder.CreateCylinder("earL", { diameterTop: 0, diameterBottom: 0.15, height: 0.2 }, scene);
    earL.parent = head;
    earL.position.set(-0.15, 0.25, 0);
    const earR = BABYLON.MeshBuilder.CreateCylinder("earR", { diameterTop: 0, diameterBottom: 0.15, height: 0.2 }, scene);
    earR.parent = head;
    earR.position.set(0.15, 0.25, 0);
  } else { // Team 3: Yellow -> Bird
    body = BABYLON.MeshBuilder.CreateBox("body", { width: 0.4, height: 0.5, depth: 0.5 }, scene);
    const head = BABYLON.MeshBuilder.CreateSphere("head", { diameter: 0.35 }, scene);
    head.parent = body;
    head.position.y = 0.3;
    head.position.z = 0.1;
    const beak = BABYLON.MeshBuilder.CreateCylinder("beak", { diameterTop: 0, diameterBottom: 0.15, height: 0.2 }, scene);
    beak.parent = head;
    beak.position.z = 0.2;
    beak.rotation.x = Math.PI / 2;
  }

  body.parent = mesh;
  body.material = mat;
  body.getChildMeshes().forEach(m => m.material = mat);

  if (isMe) {
    mesh.scaling.scaleInPlace(1.2);
    highlightLayer.addMesh(body, teamColor);
    body.getChildMeshes().forEach(m => highlightLayer.addMesh(m, teamColor));
  }

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
    camera.beta = Math.PI / 5;
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

  // Prevent default browser behavior for control keys
  const controlledKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 's', 'a', 'd', ' '];
  if (controlledKeys.includes(e.key)) {
    e.preventDefault();
  }

  // Prevent repeat bomb drops when holding spacebar
  if (e.repeat) return;

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
        <span class="player-name">
          {{ id === props.room.sessionId ? 'You' : (player.isBot ? '[BOT]' : 'Player') }}
        </span>
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
                    <div class="progress-bar" :style="{ width: (totalPlayers / 20 * 100) + '%' }"></div>
                </div>
                <span class="progress-text">{{ totalPlayers }} / 20 Participants Ready</span>
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

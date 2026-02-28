<script setup>
import { onMounted, onUnmounted, ref, computed } from 'vue';
import flareUrl from '../assets/flare.png?url';
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
const rangePreviewMeshes = [];

const TEAM_COLORS = [
  new BABYLON.Color3(1, 0.2, 0.2),   // Team 0: Red
  new BABYLON.Color3(0.2, 0.8, 0.2), // Team 1: Green
  new BABYLON.Color3(0.2, 0.5, 1.0), // Team 2: Blue
  new BABYLON.Color3(1.0, 0.9, 0.2)  // Team 3: Yellow
];

// Reactive state for UI logic
const playersData = ref({});
const basesHealth = ref({}); // team -> { health, isTurret }
const syncTimeoutReached = ref(false);
const showShop = ref(false);
let mouseWorldPos = { x: 0, z: 0 }; // tracked via pointer observable

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

const isDead = computed(() => {
    const me = playersData.value[props.room.sessionId];
    return me && !me.alive;
});

const respawnCountdown = computed(() => {
    const me = props.room.state.players.get(props.room.sessionId);
    if (!me || me.alive || !me.respawnTimestamp) return 0;
    const remaining = Math.max(0, Math.ceil((me.respawnTimestamp - Date.now()) / 1000));
    return remaining;
});

const isOnBase = computed(() => {
    const me = playersData.value[props.room.sessionId];
    if (!me || !me.alive) return false;
    
    const x = Math.round(me.x);
    const z = Math.round(me.z);
    const key = `${x},${z}`;
    
    // Check if current tile is a base OR tower belonging to player's team
    const base = props.room.state.bases.get(key);
    const tower = props.room.state.towers.get(key);
    
    const onOurTerritory = (base && base.team === me.team) || (tower && tower.team === me.team);
    
    // Auto-close shop if we move off base
    if (!onOurTerritory && showShop.value) {
        showShop.value = false;
    }
    
    return onOurTerritory;
});

const getUpgradeCost = (stat) => {
    const me = playersData.value[props.room.sessionId];
    if (!me) return 0;
    if (stat === 'weaponRange') {
        const dirCosts = { 1: 50, 4: 75, 8: 100 };
        const dirCost = dirCosts[me.weaponDirections] || 75;
        return dirCost + (me.weaponRange - 1) * dirCost;
    }
    const costs = { health: 40, armor: 60, attack: 50, critDamage: 80, critChance: 70, moveSpeed: 100 };
    return costs[stat] || 50;
};

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

  // Track mouse world position (ground plane y=0) for aim direction
  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
      if (ray.direction.y !== 0) {
        const t = -ray.origin.y / ray.direction.y;
        mouseWorldPos.x = ray.origin.x + ray.direction.x * t;
        mouseWorldPos.z = ray.origin.z + ray.direction.z * t;
      }
    }
  });

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
    const now = Date.now();
    const lerpSpeed = 0.2; // Adjust for smoothness vs responsiveness
    const rotLerpSpeed = 0.15;

    playerMeshes.forEach((mesh, sessionId) => {
      if (mesh.targetPos) {
        const dx = mesh.targetPos.x - mesh.position.x;
        const dz = mesh.targetPos.z - mesh.position.z;

        if (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) {
          const targetRotation = Math.atan2(dx, dz);
          let diff = targetRotation - mesh.rotation.y;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          mesh.rotation.y += diff * rotLerpSpeed;
        }

        // Check distance for instant snap (respawn/teleport)
        const distSq = dx * dx + dz * dz;
        if (distSq > 4) { // Distance > 2
          mesh.position.x = mesh.targetPos.x;
          mesh.position.z = mesh.targetPos.z;
        } else {
          mesh.position.x = BABYLON.Scalar.Lerp(mesh.position.x, mesh.targetPos.x, lerpSpeed);
          mesh.position.z = BABYLON.Scalar.Lerp(mesh.position.z, mesh.targetPos.z, lerpSpeed);
        }
      }
    });

    // Update Bomb Countdowns
    meshes.forEach((mesh, key) => {
      if (key.startsWith("bomb_") && mesh.explosionTimestamp) {
        const remaining = Math.max(0, Math.ceil((mesh.explosionTimestamp - now) / 1000));
        if (mesh.lastLabelValue !== remaining) {
          const texture = mesh.labelTexture;
          texture.clear();
          texture.drawText(remaining.toString(), null, null, "bold 70px Arial", "white", "transparent", true);
          mesh.lastLabelValue = remaining;
        }
      }
    });

    updateRangePreview();

    scene.render();
  });

  window.addEventListener('resize', () => engine.resize());
  window.addEventListener('keydown', handleKeyDown);
};

const setupRoomListeners = () => {
  const room = props.room;
  room.onMessage("explosion", (message) => {
    if (message.tiles) {
      message.tiles.forEach(tile => {
        createExplosionEffect(tile.x, tile.z);
        createTileGlow(tile.x, tile.z);
      });
    }
  });

  const seenGrid = new Set();
  const seenPlayers = new Set();
  const seenBombs = new Set();
  const seenCoins = new Set();
  const seenBases = new Set();
  const seenTowers = new Set();

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
          createBlockMesh(x, z, "base", key, base.team, false);
        }
      });
      // Cleanup bases
      for (const key of seenBases) {
        if (!state.bases.has(key)) {
          seenBases.delete(key);
          const mesh = meshes.get(key);
          if (mesh) { mesh.dispose(); meshes.delete(key); }
        } else {
            // Update darkening effect based on health
            const base = state.bases.get(key);
            const mesh = meshes.get(key);
            if (mesh && mesh.material) {
                const healthRatio = base.health / 500;
                const teamColor = TEAM_COLORS[base.team] || new BABYLON.Color3(0.5, 0.5, 0.5);
                // Scale color between 20% and 100% brightness based on health
                mesh.material.diffuseColor = teamColor.scale(0.2 + 0.8 * healthRatio);
                if (mesh.material.emissiveColor) {
                    mesh.material.emissiveColor = teamColor.scale((0.2 + 0.8 * healthRatio) * 0.2);
                }
            }
        }
      }
    }

    // Manual sync for Towers
    if (state.towers) {
      state.towers.forEach((tower, key) => {
        if (!seenTowers.has(key)) {
          seenTowers.add(key);
          const [x, z] = key.split(',').map(Number);
          createBlockMesh(x, z, "tower", key, tower.team, true);
        }
      });
      // Cleanup towers
      for (const key of seenTowers) {
        if (!state.towers.has(key)) {
          seenTowers.delete(key);
          const mesh = meshes.get(key);
          if (mesh) { mesh.dispose(); meshes.delete(key); }
        } else {
            // Update darkening effect based on health
            const tower = state.towers.get(key);
            const mesh = meshes.get(key);
            if (mesh && mesh.material) {
                const healthRatio = tower.health / 500;
                const teamColor = TEAM_COLORS[tower.team] || new BABYLON.Color3(0.5, 0.5, 0.5);
                mesh.material.diffuseColor = teamColor.scale(0.2 + 0.8 * healthRatio);
                if (mesh.material.emissiveColor) {
                    mesh.material.emissiveColor = teamColor.scale((0.2 + 0.8 * healthRatio) * 0.2);
                }
            }
        }
      }
    }

    // Update Bases Health HUD
    const bHealth = {};
    if (state.bases) {
      state.bases.forEach((base) => {
        if (!bHealth[base.team]) {
          bHealth[base.team] = {
            health: base.health,
            maxHealth: 500,
            isTurret: false
          };
        }
      });
    }
    if (state.towers) {
      state.towers.forEach((tower) => {
        // Priority to tower health as it represents team elimination
        bHealth[tower.team] = {
          health: tower.health,
          maxHealth: 500,
          isTurret: true
        };
      });
    }
    basesHealth.value = bHealth;

    // Manual sync for Players
    if (state.players) {
      const pData = {};
      state.players.forEach((player, sessionId) => {
        // Update reactive data for HUD and Loading Screen
        pData[sessionId] = { 
            health: player.health, 
            maxHealth: player.maxHealth,
            alive: player.alive, 
            loaded: player.loaded,
            team: player.team,
            coins: player.coins,
            birdType: player.birdType,
            armor: player.armor,
            attack: player.attack,
            critDamage: player.critDamage,
            critChance: player.critChance,
            weaponDirections: player.weaponDirections,
            weaponRange: player.weaponRange,
            moveSpeed: player.moveSpeed,
            x: player.x,
            z: player.z
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
        if (state.bombs.has(key)) {
          const bomb = state.bombs.get(key);
          if (!seenBombs.has(key)) {
            seenBombs.add(key);
            createBombMesh(bomb.x, bomb.z, key, bomb.team, bomb.explosionTimestamp);
          } else {
            // Update timestamp if it changes (though usually it doesn't)
            const mesh = meshes.get(`bomb_${key}`);
            if (mesh) mesh.explosionTimestamp = bomb.explosionTimestamp;
          }
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

    // Manual sync for Coins
    if (state.coins) {
      state.coins.forEach((coin, key) => {
        if (!seenCoins.has(key)) {
          seenCoins.add(key);
          createCoinMesh(coin.x, coin.z, key);
        }
      });
      for (const key of seenCoins) {
        if (!state.coins.has(key)) {
          seenCoins.delete(key);
          const mesh = meshes.get(`coin_${key}`);
          if (mesh) { mesh.dispose(); meshes.delete(`coin_${key}`); }
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

const createBombMesh = (x, z, key, team, explosionTimestamp) => {
  const mesh = BABYLON.MeshBuilder.CreateSphere(`bomb_${key}`, { diameter: 0.7 }, scene);
  mesh.position.set(x, 0.5, z);
  mesh.explosionTimestamp = explosionTimestamp;

  const mat = new BABYLON.StandardMaterial(`bombMat_${key}`, scene);
  const teamColor = TEAM_COLORS[team] || new BABYLON.Color3(0.1, 0.1, 0.1);
  mat.diffuseColor = teamColor.scale(0.5);
  mat.emissiveColor = teamColor.scale(0.8);
  mesh.material = mat;

  // Countdown Label
  const plane = BABYLON.MeshBuilder.CreatePlane(`bombLabel_${key}`, { size: 0.5 }, scene);
  plane.parent = mesh;
  plane.position.y = 0.8;
  plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

  const texture = new BABYLON.DynamicTexture(`bombTexture_${key}`, { width: 128, height: 128 }, scene);
  texture.hasAlpha = true;
  
  const planeMat = new BABYLON.StandardMaterial(`bombLabelMat_${key}`, scene);
  planeMat.diffuseTexture = texture;
  planeMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
  planeMat.opacityTexture = texture;
  planeMat.backFaceCulling = false;
  plane.material = planeMat;

  mesh.labelTexture = texture;
  mesh.lastLabelValue = -1;

  meshes.set(`bomb_${key}`, mesh);
};

const createCoinMesh = (x, z, key) => {
  const mesh = BABYLON.MeshBuilder.CreateCylinder(`coin_${key}`, { diameter: 0.5, height: 0.1, tessellation: 12 }, scene);
  mesh.position.set(x, 0.3, z);
  mesh.rotation.x = Math.PI / 2;

  const mat = new BABYLON.StandardMaterial(`coinMat_${key}`, scene);
  mat.diffuseColor = new BABYLON.Color3(1, 0.9, 0.2);
  mat.emissiveColor = new BABYLON.Color3(0.5, 0.4, 0);
  mesh.material = mat;

  // Add a simple rotation animation
  const anim = new BABYLON.Animation("coinRot", "rotation.y", 30, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
  const keys = [
    { frame: 0, value: 0 },
    { frame: 60, value: Math.PI * 2 }
  ];
  anim.setKeys(keys);
  mesh.animations.push(anim);
  scene.beginAnimation(mesh, 0, 60, true);

  meshes.set(`coin_${key}`, mesh);
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

const createExplosionEffect = (x, z) => {
  // Create a particle system
  const particleSystem = new BABYLON.ParticleSystem("particles", 200, scene);

  // Texture of each particle
  particleSystem.particleTexture = new BABYLON.Texture(flareUrl, scene);

  // Where the particles come from
  particleSystem.emitter = new BABYLON.Vector3(x, 0.5, z); // Position of the explosion
  particleSystem.minEmitBox = new BABYLON.Vector3(-0.5, 0, -0.5); 
  particleSystem.maxEmitBox = new BABYLON.Vector3(0.5, 0.5, 0.5); 

  // Colors of all particles
  particleSystem.color1 = new BABYLON.Color4(1, 0.5, 0, 1.0);
  particleSystem.color2 = new BABYLON.Color4(1, 0.2, 0.1, 1.0);
  particleSystem.colorDead = new BABYLON.Color4(0, 0, 0, 0.0);

  // Size of each particle
  particleSystem.minSize = 0.1;
  particleSystem.maxSize = 0.5;

  // Life time of each particle
  particleSystem.minLifeTime = 0.2;
  particleSystem.maxLifeTime = 0.5;

  // Emission rate
  particleSystem.emitRate = 500;

  // Blend mode : BLENDMODE_ONEONE, or BLENDMODE_STANDARD
  particleSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_ONEONE;

  // Set the gravity of all particles
  particleSystem.gravity = new BABYLON.Vector3(0, 9.81, 0);

  // Direction of each particle after it has been emitted
  particleSystem.direction1 = new BABYLON.Vector3(-1, 1, -1);
  particleSystem.direction2 = new BABYLON.Vector3(1, 1, 1);

  // Angular speed, in radians
  particleSystem.minAngularSpeed = 0;
  particleSystem.maxAngularSpeed = Math.PI;

  // Speed
  particleSystem.minEmitPower = 1;
  particleSystem.maxEmitPower = 5;
  particleSystem.updateSpeed = 0.005;

  // Start the particle system
  particleSystem.start();

  // Stop the particle system after a short duration
  setTimeout(() => {
    particleSystem.stop();
    setTimeout(() => {
      particleSystem.dispose();
    }, 1000); // Wait for particles to die out
  }, 200);
};

const createTileGlow = (x, z) => {
  const glow = BABYLON.MeshBuilder.CreatePlane(`glow_${x}_${z}`, { size: 0.95 }, scene);
  glow.position.set(x, 0.02, z); // Slightly above the ground
  glow.rotation.x = Math.PI / 2;

  const mat = new BABYLON.StandardMaterial(`glowMat_${x}_${z}`, scene);
  mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
  mat.alpha = 0.6;
  glow.material = mat;

  // Fade out and dispose
  let alpha = 0.6;
  const fadeOut = setInterval(() => {
    alpha -= 0.05;
    mat.alpha = alpha;
    if (alpha <= 0) {
      clearInterval(fadeOut);
      glow.dispose();
      mat.dispose();
    }
  }, 50);

  // Safety dispose
  setTimeout(() => {
    if (!glow.isDisposed()) {
        clearInterval(fadeOut);
        glow.dispose();
        mat.dispose();
    }
  }, 1000);
};

const updateRangePreview = () => {
  const me = playersData.value[props.room.sessionId];
  if (!me || !me.alive) {
    rangePreviewMeshes.forEach(m => m.dispose());
    rangePreviewMeshes.length = 0;
    return;
  }

  const x = Math.round(me.x);
  const z = Math.round(me.z);
  const range = me.weaponRange || 2;
  const dirs = me.weaponDirections || 4;
  const tiles = [{ x, z }];

  if (dirs === 4) {
    for (let i = 1; i <= range; i++) {
      tiles.push({ x: x + i, z }, { x: x - i, z }, { x, z: z + i }, { x, z: z - i });
    }
  } else if (dirs === 1) {
    // Aim toward mouse position, snapped to 8 directions
    const rawDx = mouseWorldPos.x - x;
    const rawDz = mouseWorldPos.z - z;
    const angle = Math.atan2(rawDz, rawDx);
    const octant = Math.round(angle / (Math.PI / 4));
    const snapMap = { 0: [1,0], 1: [1,1], 2: [0,1], 3: [-1,1], 4: [-1,0], '-1': [1,-1], '-2': [0,-1], '-3': [-1,-1], '-4': [-1,0] };
    const [adx, adz] = snapMap[octant] || [0, 1];
    for (let i = 1; i <= range; i++) tiles.push({ x: x + adx * i, z: z + adz * i });
  } else if (dirs === 8) {
    for (let i = 1; i <= range; i++) {
      tiles.push({ x: x + i, z }, { x: x - i, z }, { x, z: z + i }, { x, z: z - i });
      tiles.push({ x: x + i, z: z + i }, { x: x - i, z: z + i }, { x: x + i, z: z - i }, { x: x - i, z: z - i });
    }
  }

  // Reuse or recreate meshes
  while (rangePreviewMeshes.length > tiles.length) {
    rangePreviewMeshes.pop().dispose();
  }

  tiles.forEach((tile, i) => {
    let mesh = rangePreviewMeshes[i];
    if (!mesh) {
      mesh = BABYLON.MeshBuilder.CreatePlane(`rangePreview_${i}`, { size: 0.95 }, scene);
      mesh.rotation.x = Math.PI / 2;
      const mat = new BABYLON.StandardMaterial(`rangePreviewMat_${i}`, scene);
      mat.diffuseColor = new BABYLON.Color3(1, 1, 1);
      mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
      mat.alpha = 0.15;
      mesh.material = mat;
      rangePreviewMeshes.push(mesh);
    }
    mesh.position.set(tile.x, 0.015, tile.z); // Slightly lower than glow
  });
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
    case ' ':
      const me = playersData.value[props.room.sessionId];
      if (me) {
        // Calculate aim direction from player to mouse for 1-dir birds
        const rawDx = mouseWorldPos.x - me.x;
        const rawDz = mouseWorldPos.z - me.z;
        const angle = Math.atan2(rawDz, rawDx);
        // Snap to nearest of 8 directions
        const octant = Math.round(angle / (Math.PI / 4));
        const snapAngles = {
          0:  { dx: 1,  dz: 0 },
          1:  { dx: 1,  dz: 1 },
          2:  { dx: 0,  dz: 1 },
          3:  { dx: -1, dz: 1 },
          4:  { dx: -1, dz: 0 },
          '-1': { dx: 1,  dz: -1 },
          '-2': { dx: 0,  dz: -1 },
          '-3': { dx: -1, dz: -1 },
          '-4': { dx: -1, dz: 0 },
        };
        const aim = snapAngles[octant] || { dx: 0, dz: 1 };
        props.room.send("placeBomb", { aimDx: aim.dx, aimDz: aim.dz });
      } else {
        props.room.send("placeBomb");
      }
      break;
  }

  if (move) {
    props.room.send("move", move);
  }
};

const buyUpgrade = (item) => {
    props.room.send("buyItem", { item });
};
</script>

<template>
  <div class="game-view">
    <canvas ref="canvasRef"></canvas>
    <div class="hud-top-left">
      <div v-for="(player, id) in playersData" :key="id" class="player-stat" :class="{ 'is-me': id === props.room.sessionId, 'is-dead': !player.alive }">
        <span class="player-dot"></span>
        <span class="player-name">
          {{ id === props.room.sessionId ? 'You' : 'Player' }}
        </span>
        <span class="bird-badge" v-if="player.birdType">{{ { eagle: '🦅', falcon: '🐦', robin: '🐤', parrot: '🦜', crow: '🐦‍⬛', penguin: '🐧' }[player.birdType] || '🐤' }}</span>
        <div class="player-coins" v-if="player.coins !== undefined">
          💰 {{ player.coins }}
        </div>
        <div class="health-bar-bg">
          <div class="health-bar-fill" :style="{ width: (player.health / (player.maxHealth || 100) * 100) + '%' }"></div>
        </div>
        <div class="player-stat-pills" v-if="id === props.room.sessionId">
          <span>⚔️{{ player.attack }}</span>
          <span>🛡️{{ player.armor }}</span>
          <span>💥{{ player.weaponRange }}</span>
          <span>🎯{{ player.weaponDirections === 1 ? '1d' : player.weaponDirections === 8 ? '8d' : '4d' }}</span>
        </div>
      </div>
    </div>

    <div class="hud-top-right">
      <div class="base-integrity-panel">
        <div class="panel-header">BASE INTEGRITY</div>
        <div v-for="team in [0, 1, 2, 3]" :key="team" class="base-stat" :class="{ 'is-eliminated': !basesHealth[team] }">
          <div class="base-label">
            <span class="team-bullet" :style="{ background: `rgb(${TEAM_COLORS[team].r*255}, ${TEAM_COLORS[team].g*255}, ${TEAM_COLORS[team].b*255})` }"></span>
            Team {{ team }}
          </div>
          <div v-if="basesHealth[team]" class="base-health-bar">
            <div class="base-health-fill" :style="{ width: (basesHealth[team].health / basesHealth[team].maxHealth * 100) + '%' }"></div>
          </div>
          <div v-else class="base-status-tag">ELIMINATED</div>
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

    <div v-if="isDead && !winnerName" class="respawn-overlay">
        <div class="respawn-card">
            <h2>OUT OF ACTION</h2>
            <p>You will respawn at base in:</p>
            <div class="respawn-timer">{{ respawnCountdown }}s</div>
            <p class="death-hint">The Wait time increases with each death!</p>
        </div>
    </div>

    <div v-if="isSyncing && !winnerName" class="loading-overlay">
        <div class="loader-content">
            <div class="loading-spinner"></div>
            <h3>Synchronizing Arena</h3>
            <p>Waiting for all players to initialize...</p>
        </div>
    </div>

    <div v-if="isOnBase" class="shop-trigger">
        <button @click="showShop = true" class="btn-shop">🏪 OPEN SHOP</button>
    </div>

    <div v-if="showShop" class="shop-modal" @click.self="showShop = false">
        <div class="shop-card">
            <div class="shop-header">
                <h2>UPGRADE SHOP</h2>
                <button @click="showShop = false" class="close-shop">&times;</button>
            </div>
            <div class="shop-items">
                <div class="shop-item">
                    <div class="item-info">
                        <h3>💥 Weapon Range</h3>
                        <p>Current: {{ playersData[props.room.sessionId]?.weaponRange || 2 }}</p>
                    </div>
                    <button @click="buyUpgrade('weaponRange')" class="btn-buy"
                        :disabled="(playersData[props.room.sessionId]?.coins || 0) < getUpgradeCost('weaponRange')">
                        💰 {{ getUpgradeCost('weaponRange') }}
                    </button>
                </div>
                <div class="shop-item">
                    <div class="item-info">
                        <h3>❤️ Health</h3>
                        <p>Current: {{ playersData[props.room.sessionId]?.maxHealth || 100 }}</p>
                    </div>
                    <button @click="buyUpgrade('health')" class="btn-buy"
                        :disabled="(playersData[props.room.sessionId]?.coins || 0) < getUpgradeCost('health')">
                        💰 {{ getUpgradeCost('health') }}
                    </button>
                </div>
                <div class="shop-item">
                    <div class="item-info">
                        <h3>⚔️ Attack</h3>
                        <p>Current: {{ playersData[props.room.sessionId]?.attack || 50 }}</p>
                    </div>
                    <button @click="buyUpgrade('attack')" class="btn-buy"
                        :disabled="(playersData[props.room.sessionId]?.coins || 0) < getUpgradeCost('attack')">
                        💰 {{ getUpgradeCost('attack') }}
                    </button>
                </div>
                <div class="shop-item">
                    <div class="item-info">
                        <h3>🛡️ Armor</h3>
                        <p>Current: {{ playersData[props.room.sessionId]?.armor || 0 }}</p>
                    </div>
                    <button @click="buyUpgrade('armor')" class="btn-buy"
                        :disabled="(playersData[props.room.sessionId]?.coins || 0) < getUpgradeCost('armor')">
                        💰 {{ getUpgradeCost('armor') }}
                    </button>
                </div>
                <div class="shop-item">
                    <div class="item-info">
                        <h3>🎯 Crit Chance</h3>
                        <p>Current: {{ playersData[props.room.sessionId]?.critChance || 10 }}%</p>
                    </div>
                    <button @click="buyUpgrade('critChance')" class="btn-buy"
                        :disabled="(playersData[props.room.sessionId]?.coins || 0) < getUpgradeCost('critChance')">
                        💰 {{ getUpgradeCost('critChance') }}
                    </button>
                </div>
                <div class="shop-item">
                    <div class="item-info">
                        <h3>🏃 Move Speed</h3>
                        <p>Current: {{ playersData[props.room.sessionId]?.moveSpeed || 1 }}×</p>
                    </div>
                    <button @click="buyUpgrade('moveSpeed')" class="btn-buy"
                        :disabled="(playersData[props.room.sessionId]?.coins || 0) < getUpgradeCost('moveSpeed')">
                        💰 {{ getUpgradeCost('moveSpeed') }}
                    </button>
                </div>
            </div>
            <div class="shop-footer">
                Your Balance: 💰 {{ playersData[props.room.sessionId]?.coins || 0 }}
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

.hud-top-right {
    position: absolute;
    top: 20px;
    right: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    pointer-events: none;
}

.base-integrity-panel {
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
    padding: 16px;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    min-width: 180px;
}

.panel-header {
    font-size: 0.75rem;
    font-weight: 800;
    color: #64748b;
    margin-bottom: 12px;
    letter-spacing: 0.05em;
}

.base-stat {
    margin-bottom: 10px;
}

.base-stat:last-child {
    margin-bottom: 0;
}

.base-stat.is-eliminated {
    opacity: 0.4;
}

.base-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.813rem;
    font-weight: 600;
    margin-bottom: 4px;
}

.team-bullet {
    width: 6px;
    height: 6px;
    border-radius: 50%;
}

.base-health-bar {
    height: 4px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 2px;
    overflow: hidden;
}

.base-health-fill {
    height: 100%;
    background: #3b82f6;
    transition: width 0.4s ease;
}

.base-status-tag {
    font-size: 0.688rem;
    font-weight: 700;
    color: #ef4444;
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

.bird-badge {
    font-size: 0.9rem;
    margin-left: 2px;
}

.player-stat-pills {
    display: flex;
    gap: 4px;
    margin-top: 2px;
}

.player-stat-pills span {
    font-size: 0.55rem;
    background: rgba(148, 163, 184, 0.15);
    padding: 1px 4px;
    border-radius: 6px;
    color: #94a3b8;
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

.respawn-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 150;
}

.respawn-card {
    background: #1e293b;
    padding: 40px;
    border-radius: 24px;
    text-align: center;
    border: 1px solid rgba(239, 68, 68, 0.3);
    box-shadow: 0 0 40px rgba(239, 68, 68, 0.2);
    animation: pulseBorder 2s infinite;
}

@keyframes pulseBorder {
    0% { border-color: rgba(239, 68, 68, 0.3); }
    50% { border-color: rgba(239, 68, 68, 0.6); }
    100% { border-color: rgba(239, 68, 68, 0.3); }
}

.respawn-card h2 {
    font-size: 2rem;
    color: #ef4444;
    margin-bottom: 12px;
    letter-spacing: 0.1em;
}

.respawn-timer {
    font-size: 4rem;
    font-weight: 800;
    color: #fff;
    margin: 20px 0;
}

.death-hint {
    font-size: 0.875rem;
    color: #64748b;
    font-style: italic;
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
.player-coins {
    font-size: 0.75rem;
    font-weight: 700;
    color: #f59e0b;
    margin-right: 4px;
}

.shop-trigger {
    position: absolute;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
}

.btn-shop {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 12px 24px;
    border-radius: 30px;
    font-weight: 800;
    font-size: 1rem;
    cursor: pointer;
    box-shadow: 0 4px 15px rgba(59, 130, 246, 0.4);
    transition: all 0.2s;
    letter-spacing: 0.05em;
}

.btn-shop:hover {
    background: #2563eb;
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5);
}

.shop-modal {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 300;
}

.shop-card {
    background: #1e293b;
    width: 400px;
    border-radius: 24px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    overflow: hidden;
}

.shop-header {
    padding: 24px;
    background: rgba(255, 255, 255, 0.03);
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.shop-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    color: #3b82f6;
}

.close-shop {
    background: none;
    border: none;
    color: #64748b;
    font-size: 1.5rem;
    cursor: pointer;
    line-height: 1;
}

.shop-items {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.shop-item {
    background: rgba(255, 255, 255, 0.03);
    padding: 16px;
    border-radius: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border: 1px solid rgba(255, 255, 255, 0.05);
}

.item-info h3 {
    margin: 0 0 4px 0;
    font-size: 1rem;
    font-weight: 700;
}

.item-info p {
    margin: 0;
    font-size: 0.813rem;
    color: #94a3b8;
}

.btn-buy {
    background: #10b981;
    color: white;
    border: none;
    padding: 10px 16px;
    border-radius: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
}

.btn-buy:hover:not(:disabled) {
    background: #059669;
    transform: scale(1.05);
}

.btn-buy:disabled {
    opacity: 0.3;
    cursor: not-allowed;
}

.shop-footer {
    padding: 16px 24px;
    background: rgba(0, 0, 0, 0.2);
    font-size: 0.875rem;
    font-weight: 700;
    color: #f59e0b;
    text-align: center;
}
</style>

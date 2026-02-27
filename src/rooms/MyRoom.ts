import { Room, Client, CloseCode } from "colyseus";
import { MyRoomState } from "./schema/MyRoomState.js";
import { Player } from "./schema/Player.js";
import { Block } from "./schema/Block.js";
import { Base } from "./schema/Base.js";
import { Bomb } from "./schema/Bomb.js";
import { Tower } from "./schema/Tower.js";
import { Coin } from "./schema/Coin.js";

const GREEK_LETTERS = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
  'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi',
  'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega'
];

export class MyRoom extends Room {
  maxClients = 20;
  state = new MyRoomState();
  countdownInterval: any;
  turretLastFired: Map<string, number> = new Map(); // key -> timestamp

  onCreate(options: any) {
    console.log(`[PID ${process.pid}] MyRoom: onCreate for room ${this.roomId}`);
    if (options.name) {
      this.state.roomName = options.name;
    } else {
      const name = GREEK_LETTERS[Math.floor(Math.random() * GREEK_LETTERS.length)];
      this.state.roomName = name;
    }
    this.setMetadata({ name: this.state.roomName });

    this.onMessage("placeBomb", (client) => {
      if (!this.state.gameStarted) return;
      const player = this.state.players.get(client.sessionId);
      if (player && player.alive) {
        this.placeBombInternal(player, client.sessionId);
      }
    });

    this.onMessage("move", (client, message) => {
      if (!this.state.gameStarted) return;
      const player = this.state.players.get(client.sessionId);
      if (player && player.alive) {
        const nextX = player.x + (message.dx || 0);
        const nextZ = player.z + (message.dz || 0);

        // Simple collision detection (grid blocks or bombs or enemy bases)
        const block = this.state.grid.get(`${nextX},${nextZ}`);
        const bomb = this.state.bombs.get(`${nextX},${nextZ}`);
        const base = this.state.bases.get(`${nextX},${nextZ}`);

        let canMove = !bomb;
        if (block) {
          canMove = false;
        }
        if (base) {
          canMove = base.team === player.team;
        }

        if (canMove) {
          player.x = nextX;
          player.z = nextZ;

          // Pickup coins
          const coinKey = `${Math.round(nextX)},${Math.round(nextZ)}`;
          if (this.state.coins.has(coinKey)) {
            this.state.coins.delete(coinKey);
            player.coins += 10;
            console.log(`Player ${client.sessionId} picked up a coin at ${coinKey}. Total: ${player.coins}`);
          }
        }
      }
    });

    this.onMessage("ready", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.ready = !player.ready;
        this.checkAllReady();
      }
    });

    this.onMessage("guiLoaded", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.loaded = true;
        console.log(`Player ${client.sessionId} GUI loaded.`);
      }
    });


    this.onMessage("buyItem", (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      if (message.item === "bombRange") {
        const cost = 50 + (player.bombRange - 1) * 50;
        if (player.coins >= cost) {
          player.coins -= cost;
          player.bombRange++;
          console.log(`Player ${client.sessionId} bought bombRange. Now ${player.bombRange}`);
        }
      }
    });

    this.initGrid();
    
    // Random block spawner every 10 seconds
    this.clock.setInterval(() => {
      if (!this.state.gameStarted) return;
      this.spawnRandomBlocks(5);
    }, 10000);

    // Set simulation interval for health recharge
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 100);
  }

  update(deltaTime: number) {
    const now = Date.now();
    this.state.players.forEach((player, sessionId) => {
      if (player.alive && player.health < 100) {
        const base = this.state.bases.get(`${Math.round(player.x)},${Math.round(player.z)}`);
        if (base && base.team === player.team) {
          player.health = Math.min(100, player.health + (10 * deltaTime / 1000));
        }
      }
    });

    if (!this.state.gameStarted) {
      return;
    }

    this.state.players.forEach((player, sessionId) => {
      if (!player.alive && player.respawnTimestamp > 0 && now >= player.respawnTimestamp) {
        this.respawnPlayer(sessionId, player);
      }
    });

    for (const [key, tower] of this.state.towers) {
      const lastFired = this.turretLastFired.get(key) || 0;
      if (now - lastFired <= 4000) {
        continue; // 4 second cooldown
      }
      const [tx, tz] = key.split(',').map(Number);
      this.turretFire(key, tx, tz, tower.team);
    }
  }

  turretFire(key: string, tx: number, tz: number, team: number) {
    let nearestEnemy: Player | null = null;
    let minDistance = 5; // Max range

    this.state.players.forEach((p) => {
      if (p.alive && p.team !== team) {
        const dist = Math.sqrt(Math.pow(p.x - tx, 2) + Math.pow(p.z - tz, 2));
        if (dist < minDistance) {
          minDistance = dist;
          nearestEnemy = p;
        }
      }
    });

    if (nearestEnemy) {
      const targetX = Math.round(nearestEnemy.x);
      const targetZ = Math.round(nearestEnemy.z);
      const bombKey = `${targetX},${targetZ}`;

      if (!this.state.bombs.has(bombKey)) {
        console.log(`Turret ${key} firing at ${targetX},${targetZ}`);
        const bomb = new Bomb();
        bomb.x = targetX;
        bomb.z = targetZ;
        bomb.ownerId = `turret_${key}`;
        bomb.team = team;
        bomb.explosionTimestamp = Date.now() + 2000;
        this.state.bombs.set(bombKey, bomb);
        this.clock.setTimeout(() => this.explode(targetX, targetZ), 2000); // 2s fuse for turret bombs
        this.turretLastFired.set(key, Date.now());
      }
    }
  }

  placeBombInternal(player: Player, ownerId: string) {
    const x = Math.round(player.x);
    const z = Math.round(player.z);
    const bombKey = `${x},${z}`;

    if (!this.state.bombs.has(bombKey)) {
      const bomb = new Bomb();
      bomb.x = x;
      bomb.z = z;
      bomb.ownerId = ownerId;
      bomb.team = player.team;
      bomb.explosionTimestamp = Date.now() + 3000;
      this.state.bombs.set(bombKey, bomb);
      this.clock.setTimeout(() => this.explode(x, z), 3000);
    }
  }

  checkAllReady() {
    let allReady = true;
    this.state.players.forEach(p => {
      if (!p.ready) allReady = false;
    });
    const hasMinimumPlayers = this.state.players.size >= 2;

    if (allReady && hasMinimumPlayers) {
      if (!this.countdownInterval) {
        this.state.countdown = 10;
        this.countdownInterval = this.clock.setInterval(() => {
          this.state.countdown--;
          if (this.state.countdown <= 0) {
            this.state.gameStarted = true;
            this.state.countdown = 0;
            this.countdownInterval.clear();
            this.countdownInterval = null;
            // Clear turret fire timers on game start (just in case)
            this.turretLastFired.clear();
            // Stamp start time in public metadata for lobby display
            this.setMetadata({ name: this.state.roomName, gameStarted: true, gameStartedAt: Date.now() });
          }
        }, 1000);
      }
    } else {
      // Someone unreadied or not everyone ready
      if (this.countdownInterval) {
        this.countdownInterval.clear();
        this.countdownInterval = null;
        this.state.countdown = 0;
      }
    }
  }

  initGrid() {
    const size = this.state.roomSize;

    // Team Bases
    // T0: Bottom-Left (1,1)-(3,3)
    // T1: Top-Right (21,21)-(23,23)
    // T2: Top-Left (1,21)-(3,23)
    // T3: Bottom-Right (21,1)-(23,3)
    const placeBase = (startX: number, startZ: number, team: number) => {
      for (let x = startX; x < startX + 5; x++) {
        for (let z = startZ; z < startZ + 5; z++) {
          if (x === startX + 2 && z === startZ + 2) {
            const t = new Tower();
            t.team = team;
            t.health = 500;
            this.state.towers.set(`${x},${z}`, t);
          } else {
            const b = new Base();
            b.team = team;
            b.health = 500; // Turrets are even tougher
            this.state.bases.set(`${x},${z}`, b);
          }
        }
      }
    };

    placeBase(1, 1, 0);
    placeBase(size - 6, size - 6, 1);
    placeBase(1, size - 6, 2);
    placeBase(size - 6, 1, 3);

    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        const key = `${x},${z}`;
        if (this.state.grid.has(key)) continue;

        if (x === 0 || x === size - 1 || z === 0 || z === size - 1) {
          const b = new Block(); b.type = "indestructible";
          this.state.grid.set(key, b);
        } else if (x % 2 === 0 && z % 2 === 0) {
          const b = new Block(); b.type = "indestructible";
          this.state.grid.set(key, b);
        } else if (Math.random() > 0.7) {
          // Expanded corner protection (7x7) to accommodate relocated bases and spawn offsets
          const isCorner = (x <= 6 && z <= 6) || (x >= size - 7 && z >= size - 7) || (x <= 6 && z >= size - 7) || (x >= size - 7 && z <= 6);
          if (!isCorner) {
            const b = new Block(); b.type = "destructible";
            this.state.grid.set(key, b);
          }
        }
      }
    }
  }

  explode(x: number, z: number) {
    const bombKey = `${x},${z}`;
    const bomb = this.state.bombs.get(bombKey);
    let range = 1;
    let owner: Player | null = null;
    if (bomb) {
      owner = this.state.players.get(bomb.ownerId);
      if (owner) range = owner.bombRange;
    }
    
    this.state.bombs.delete(bombKey);

    const directions = [
      { dx: 0, dz: 0 } // Center
    ];
    for (let i = 1; i <= range; i++) {
      directions.push({ dx: i, dz: 0 });
      directions.push({ dx: -i, dz: 0 });
      directions.push({ dx: 0, dz: i });
      directions.push({ dx: 0, dz: -i });
    }

    const affectedTiles: { x: number, z: number }[] = [];
    directions.forEach(dir => {
      const tx = x + dir.dx;
      const tz = z + dir.dz;
      const key = `${tx},${tz}`;
      affectedTiles.push({ x: tx, z: tz });

      // Destroy blocks
      const block = this.state.grid.get(key);
      if (block && block.type === "destructible") {
        this.state.grid.delete(key);
        if (owner) {
          owner.coins += 10;
        }
        
        // Drop a coin (100% chance for now as requested)
        const coin = new Coin();
        coin.x = tx;
        coin.z = tz;
        this.state.coins.set(key, coin);
      }

      const base = this.state.bases.get(key);
      if (base) {
        base.health -= 50;
        if (base.health <= 0) {
          this.state.bases.delete(key);
          this.checkWinner();
        }
      }

      // Damage players
      this.state.players.forEach((player, sessionId) => {
        if (Math.round(player.x) === tx && Math.round(player.z) === tz) {
          player.health -= 50;
          if (player.health <= 0 && player.alive) {
            this.handlePlayerDeath(sessionId, player);
          }
        }
      });
    });

    this.broadcast("explosion", { tiles: affectedTiles });
  }

  checkWinner() {
    const aliveTeams = new Set<number>();
    this.state.bases.forEach(base => {
      aliveTeams.add(base.team);
    });

    if (aliveTeams.size === 1 && this.state.gameStarted) {
      const winnerTeamId = Array.from(aliveTeams)[0];
      // Find a player from the winning team to be the winnerId
      for (let [id, player] of this.state.players.entries()) {
        if (player.team === winnerTeamId) {
          this.state.winnerId = id;
          break;
        }
      }
    }
  }

  onAuth(client: Client, options: any) {
    console.log(`[PID ${process.pid}] MyRoom: onAuth for client ${client.sessionId}`);
    return true;
  }

  onJoin(client: Client, options: any) {
    console.log(`[PID ${process.pid}] MyRoom: onJoin for client ${client.sessionId}`);
    const player = new Player();
    player.coins = 100; // Starting coins for testing

    if (options.partyId) {
      player.partyId = options.partyId;

      let existingTeam = -1;
      this.state.players.forEach(p => {
        if (p.partyId === options.partyId) {
          existingTeam = p.team;
        }
      });

      if (existingTeam !== -1) {
        player.team = existingTeam;
      } else {
        const usedTeams = new Set();
        this.state.players.forEach(p => usedTeams.add(p.team));
        for (let i = 0; i < 4; i++) {
          if (!usedTeams.has(i)) {
            player.team = i;
            break;
          }
        }
        if (player.team === -1) player.team = 0;
      }
    } else {
      const usedTeams = new Set();
      this.state.players.forEach(p => usedTeams.add(p.team));
      for (let i = 0; i < 4; i++) {
        if (!usedTeams.has(i)) {
          player.team = i;
          break;
        }
      }
      if (player.team === -1) player.team = 0;
    }

    const size = 25;

    const spawn = this.getSpawnPosition(player.team, this.getTeamMemberCount(player.team));
    player.x = spawn.x;
    player.z = spawn.z;

    this.state.players.set(client.sessionId, player);
    this.checkAllReady();
  }

  getTeamMemberCount(team: number) {
    let count = 0;
    this.state.players.forEach(p => {
      if (p.team === team) count++;
    });
    return count;
  }

  getSpawnPosition(team: number, index: number) {
    const size = 25;
    const formation = [
      { up: 4, right: 0 }, { up: 4, right: 2 }, { up: 4, right: 4 },
      { up: 2, right: 4 }, { up: 0, right: 4 }
    ];
    const offset = formation[index % formation.length];
    let x = 0, z = 0;

    if (team === 0) { x = 1 + offset.right; z = 1 + offset.up; }
    else if (team === 1) { x = (size - 2) - offset.right; z = (size - 2) - offset.up; }
    else if (team === 2) { x = 1 + offset.up; z = (size - 2) - offset.right; }
    else if (team === 3) { x = (size - 2) - offset.up; z = 1 + offset.right; }

    return { x, z };
  }

  getFibonacci(n: number): number {
    if (n <= 1) return 1;
    let a = 1, b = 1;
    for (let i = 2; i <= n; i++) {
      let temp = a + b;
      a = b;
      b = temp;
    }
    return b;
  }

  handlePlayerDeath(sessionId: string, player: Player) {
    player.alive = false;
    player.health = 0;
    player.deathCount++;
    const delaySeconds = this.getFibonacci(player.deathCount);
    player.respawnTimestamp = Date.now() + (delaySeconds * 1000);
    console.log(`Player ${sessionId} died! Respawning in ${delaySeconds}s (Fibonacci ${player.deathCount})`);
  }

  respawnPlayer(sessionId: string, player: Player) {
    player.alive = true;
    player.health = 100;
    player.respawnTimestamp = 0;

    // Find original spawn index for this player
    let myIndex = 0;
    let found = false;
    for (const [id, p] of this.state.players.entries()) {
      if (id === sessionId) {
        found = true;
        break;
      }
      if (p.team === player.team) myIndex++;
    }

    const spawn = this.getSpawnPosition(player.team, myIndex);
    player.x = spawn.x;
    player.z = spawn.z;
    console.log(`Player ${sessionId} respawned at ${player.x}, ${player.z}`);
  }

  onLeave(client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!", code);
    this.state.players.delete(client.sessionId);
    this.checkAllReady();
  }

  spawnRandomBlocks(count: number) {
    const size = this.state.roomSize;
    const maxBlocks = Math.floor(size * size * 0.25);
    
    // Count current destructible blocks
    let currentBlocks = 0;
    this.state.grid.forEach(block => {
      if (block.type === "destructible") currentBlocks++;
    });

    if (currentBlocks >= maxBlocks) {
      console.log(`Block limit reached (${currentBlocks}/${maxBlocks}). No new blocks spawned.`);
      return;
    }

    // Limit count to not exceed maxBlocks
    const countToSpawn = Math.min(count, maxBlocks - currentBlocks);

    let placed = 0;
    let attempts = 0;
    
    while (placed < countToSpawn && attempts < 50) {
      attempts++;
      const x = Math.floor(Math.random() * (size - 2)) + 1;
      const z = Math.floor(Math.random() * (size - 2)) + 1;
      const key = `${x},${z}`;

      // Avoid spawning on existing objects
      if (this.state.grid.has(key) || this.state.bases.has(key) || this.state.towers.has(key) || this.state.bombs.has(key)) {
        continue;
      }

      // Corner protection (7x7)
      const isCorner = (x <= 6 && z <= 6) || (x >= size - 7 && z >= size - 7) || (x <= 6 && z >= size - 7) || (x >= size - 7 && z <= 6);
      if (isCorner) continue;

      // Ensure no player is standing there
      let playerPresent = false;
      this.state.players.forEach(p => {
        if (Math.round(p.x) === x && Math.round(p.z) === z) playerPresent = true;
      });
      if (playerPresent) continue;

      const block = new Block();
      block.type = "destructible";
      this.state.grid.set(key, block);
      placed++;
    }
    
    if (placed > 0) {
      console.log(`Spawned ${placed} new destructible blocks.`);
    }
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }
}

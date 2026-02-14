import { Room, Client, CloseCode } from "colyseus";
import { MyRoomState, Player, Block, Bomb, Base } from "./schema/MyRoomState.js";
import { exit } from "process";

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

    this.onMessage("addBot", (client) => {
      if (this.state.gameStarted) return;
      if (this.state.players.size >= 20) return;

      const player = this.state.players.get(client.sessionId);
      if (player) {
        const botId = `bot_${Math.random().toString(36).substr(2, 9)}`;
        this.addBot(botId, player.team);
      }
    });

    this.initGrid();

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

    // Bot AI
    this.state.players.forEach((player, sessionId) => {
      if (player.isBot && player.alive) {
        this.updateBot(player, sessionId);
      }
    });

    for (const [key, base] of this.state.bases) {
      if (!base.isTurret) {
        continue;
      }
      const lastFired = this.turretLastFired.get(key) || 0;
      if (now - lastFired <= 4000) {
        continue; // 4 second cooldown
      }
      const [tx, tz] = key.split(',').map(Number);
      this.turretFire(key, tx, tz, base.team);
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
        this.state.bombs.set(bombKey, bomb);
        this.clock.setTimeout(() => this.explode(targetX, targetZ), 2000); // 2s fuse for turret bombs
        this.turretLastFired.set(key, Date.now());
      }
    }
  }

  addBot(sessionId: string, team: number) {
    const player = new Player();
    player.team = team;
    player.isBot = true;
    player.ready = true;
    player.loaded = true;

    // Reuse spawn formation logic
    let teamIndex = 0;
    this.state.players.forEach(p => {
      if (p.team === team) teamIndex++;
    });

    const size = 25;
    const formation = [
      { up: 4, right: 0 }, { up: 4, right: 2 }, { up: 4, right: 4 },
      { up: 2, right: 4 }, { up: 0, right: 4 }
    ];
    const offset = formation[teamIndex % formation.length];

    if (team === 0) { player.x = 1 + offset.right; player.z = 1 + offset.up; }
    else if (team === 1) { player.x = (size - 2) - offset.right; player.z = (size - 2) - offset.up; }
    else if (team === 2) { player.x = 1 + offset.up; player.z = (size - 2) - offset.right; }
    else if (team === 3) { player.x = (size - 2) - offset.up; player.z = 1 + offset.right; }

    this.state.players.set(sessionId, player);
    this.checkAllReady();
  }

  updateBot(bot: Player, sessionId: string) {
    if (!bot.alive) return;

    // Very simple Bot AI: move towards nearest enemy or bomb if close
    let nearestEnemy: Player | null = null;
    let minDistance = 100;

    this.state.players.forEach((p, id) => {
      if (p.alive && p.team !== bot.team) {
        const dist = Math.sqrt(Math.pow(p.x - bot.x, 2) + Math.pow(p.z - bot.z, 2));
        if (dist < minDistance) {
          minDistance = dist;
          nearestEnemy = p;
        }
      }
    });

    if (nearestEnemy) {
      const dx = nearestEnemy.x - bot.x;
      const dz = nearestEnemy.z - bot.z;
      const step = 0.5;

      let moveX = 0;
      let moveZ = 0;

      if (Math.abs(dx) > Math.abs(dz)) moveX = dx > 0 ? step : -step;
      else moveZ = dz > 0 ? step : -step;

      const nextX = bot.x + moveX;
      const nextZ = bot.z + moveZ;

      const block = this.state.grid.get(`${nextX},${nextZ}`);
      const bomb = this.state.bombs.get(`${nextX},${nextZ}`);
      const base = this.state.bases.get(`${nextX},${nextZ}`);

      if (!bomb && !block && (!base || base.team === bot.team)) {
        bot.x = nextX;
        bot.z = nextZ;
      }

      // Randomly place bomb if near enemy
      if (minDistance < 2 && Math.random() < 0.1) {
        this.placeBombInternal(bot, sessionId);
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
      this.state.bombs.set(bombKey, bomb);
      this.clock.setTimeout(() => this.explode(x, z), 3000);
    }
  }

  checkAllReady() {
    let allReady = true;
    this.state.players.forEach(p => {
      if (!p.ready && !p.isBot) allReady = false;
    });

    const hasEnoughPlayers = this.state.players.size === 20;

    if (allReady && hasEnoughPlayers) {
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
    const size = 25;

    // Team Bases
    // T0: Bottom-Left (1,1)-(3,3)
    // T1: Top-Right (21,21)-(23,23)
    // T2: Top-Left (1,21)-(3,23)
    // T3: Bottom-Right (21,1)-(23,3)
    const placeBase = (startX: number, startZ: number, team: number) => {
      for (let x = startX; x < startX + 3; x++) {
        for (let z = startZ; z < startZ + 3; z++) {
          if (x === startX + 1 && z === startZ + 1) {
            const b = new Base();
            b.team = team;
            b.health = 500; // Turrets are even tougher
            b.isTurret = true;
            this.state.bases.set(`${x},${z}`, b);
          } else {
            const b = new Base();
            b.team = team;
            b.health = 200; // Bases are tougher
            this.state.bases.set(`${x},${z}`, b);
          }
        }
      }
    };

    placeBase(1, 1, 0);
    placeBase(size - 4, size - 4, 1);
    placeBase(1, size - 4, 2);
    placeBase(size - 4, 1, 3);

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
          // Expanded corner protection (6x6) to accommodate teammate spawn offsets
          const isCorner = (x <= 5 && z <= 5) || (x >= size - 6 && z >= size - 6) || (x <= 5 && z >= size - 6) || (x >= size - 6 && z <= 5);
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
    this.state.bombs.delete(bombKey);

    const directions = [
      { dx: 0, dz: 0 }, // Center
      { dx: 1, dz: 0 }, { dx: -1, dz: 0 },
      { dx: 0, dz: 1 }, { dx: 0, dz: -1 }
    ];

    directions.forEach(dir => {
      const tx = x + dir.dx;
      const tz = z + dir.dz;
      const key = `${tx},${tz}`;

      // Destroy blocks
      const block = this.state.grid.get(key);
      if (block && block.type === "destructible") {
        this.state.grid.delete(key);
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
          if (player.health <= 0) {
            player.alive = false;
            this.checkWinner();
          }
        }
      });
    });
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

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    const player = new Player();

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

    // Calculate index within team for formation
    let teamIndex = 0;
    this.state.players.forEach(p => {
      if (p.team === player.team) teamIndex++;
    });

    const formation = [
      { up: 4, right: 0 }, // P1
      { up: 4, right: 2 }, // P2
      { up: 4, right: 4 }, // P3
      { up: 2, right: 4 }, // P4
      { up: 0, right: 4 }  // P5
    ];

    const offset = formation[teamIndex % formation.length];

    // Base corners and axis directions
    if (player.team === 0) { // Bottom-Left (alpha -PI/2) -> Up:+Z, Right:+X
      player.x = 1 + offset.right;
      player.z = 1 + offset.up;
    } else if (player.team === 1) { // Top-Right (alpha PI/2) -> Up:-Z, Right:-X
      player.x = (size - 2) - offset.right;
      player.z = (size - 2) - offset.up;
    } else if (player.team === 2) { // Top-Left (alpha PI) -> Up:+X, Right:-Z (wait, see GameView remapping)
      // Team 2 GameView mapping: W(Up): +X, D(Right): -Z
      player.x = 1 + offset.up;
      player.z = (size - 2) - offset.right;
    } else if (player.team === 3) { // Bottom-Right (alpha 0) -> Up:-X, Right:+Z
      // Team 3 GameView mapping: W(Up): -X, D(Right): +Z
      player.x = (size - 2) - offset.up;
      player.z = 1 + offset.right;
    }

    this.state.players.set(client.sessionId, player);
    this.checkAllReady();
  }

  onLeave(client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!", code);
    this.state.players.delete(client.sessionId);
    this.checkAllReady();
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }
}

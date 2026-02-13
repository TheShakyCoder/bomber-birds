import { Room, Client, CloseCode } from "colyseus";
import { MyRoomState, Player, Block, Bomb } from "./schema/MyRoomState.js";

export class MyRoom extends Room {
  maxClients = 20;
  state = new MyRoomState();
  countdownInterval: any;

  onCreate (options: any) {
    this.onMessage("placeBomb", (client) => {
      if (!this.state.gameStarted) return;
      const player = this.state.players.get(client.sessionId);
      if (player && player.alive) {
        const x = Math.round(player.x);
        const z = Math.round(player.z);
        const bombKey = `${x},${z}`;

        if (!this.state.bombs.has(bombKey)) {
          const bomb = new Bomb();
          bomb.x = x;
          bomb.z = z;
          bomb.ownerId = client.sessionId;
          this.state.bombs.set(bombKey, bomb);

          this.clock.setTimeout(() => this.explode(x, z), 3000);
        }
      }
    });

    this.onMessage("move", (client, message) => {
      if (!this.state.gameStarted) return;
      const player = this.state.players.get(client.sessionId);
      if (player && player.alive) {
        const nextX = player.x + (message.dx || 0);
        const nextZ = player.z + (message.dz || 0);

        // Simple collision detection (grid blocks or bombs)
        const block = this.state.grid.get(`${nextX},${nextZ}`);
        const bomb = this.state.bombs.get(`${nextX},${nextZ}`);
        if (!block && !bomb) {
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

    if (options.name) {
      this.state.roomName = options.name;
      this.setMetadata({ name: options.name });
    }
    this.initGrid();
  }

  checkAllReady() {
    let allReady = true;
    this.state.players.forEach(p => {
      if (!p.ready) allReady = false;
    });

    const hasEnoughPlayers = this.state.players.size >= 1; // Start with 1 for testing

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
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        if (x === 0 || x === size - 1 || z === 0 || z === size - 1) {
          const b = new Block(); b.type = "indestructible";
          this.state.grid.set(`${x},${z}`, b);
        } else if (x % 2 === 0 && z % 2 === 0) {
          const b = new Block(); b.type = "indestructible";
          this.state.grid.set(`${x},${z}`, b);
        } else if (Math.random() > 0.7) {
          // Expanded corner protection (6x6) to accommodate teammate spawn offsets
          const isCorner = (x <= 5 && z <= 5) || (x >= size - 6 && z >= size - 6) || (x <= 5 && z >= size - 6) || (x >= size - 6 && z <= 5);
          if (!isCorner) {
            const b = new Block(); b.type = "destructible";
            this.state.grid.set(`${x},${z}`, b);
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
    const alivePlayers = Array.from(this.state.players.values()).filter(p => p.alive);
    
    // Check if only one team is left alive
    const aliveTeams = new Set(alivePlayers.map(p => p.team));
    
    if (aliveTeams.size === 1 && this.state.players.size > 1) {
        // Find the team ID
        const winnerTeamId = Array.from(aliveTeams)[0];
        // For now, we set winnerId to one of the winners
        for (let [id, player] of this.state.players.entries()) {
            if (player.alive) {
                this.state.winnerId = id; 
                break;
            }
        }
    }
  }

  onJoin (client: Client, options: any) {
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

  onLeave (client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!", code);
    this.state.players.delete(client.sessionId);
    this.checkAllReady();
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }
}

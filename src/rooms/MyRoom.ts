import { Room, Client, CloseCode } from "colyseus";
import { MyRoomState, Player, Block, Bomb } from "./schema/MyRoomState.js";

export class MyRoom extends Room {
  maxClients = 4;
  state = new MyRoomState();

  onCreate (options: any) {
    this.onMessage("placeBomb", (client) => {
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

    if (options.name) {
      this.setMetadata({ name: options.name });
    }
    this.initGrid();
  }

  initGrid() {
    for (let x = 0; x < 15; x++) {
      for (let z = 0; z < 15; z++) {
        if (x === 0 || x === 14 || z === 0 || z === 14) {
          const b = new Block(); b.type = "indestructible";
          this.state.grid.set(`${x},${z}`, b);
        } else if (x % 2 === 0 && z % 2 === 0) {
          const b = new Block(); b.type = "indestructible";
          this.state.grid.set(`${x},${z}`, b);
        } else if (Math.random() > 0.7) {
          const isCorner = (x <= 2 && z <= 2) || (x >= 12 && z >= 12) || (x <= 2 && z >= 12) || (x >= 12 && z <= 2);
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
    if (alivePlayers.length === 1 && this.state.players.size > 1) {
        // Find the sessionId of the winner
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
    
    // Simple spawn point logic (corners)
    const spawnPoints = [
      { x: 1, z: 1 },
      { x: 13, z: 13 },
      { x: 1, z: 13 },
      { x: 13, z: 1 },
    ];
    const spawn = spawnPoints[this.clients.length % spawnPoints.length];
    player.x = spawn.x;
    player.z = spawn.z;

    this.state.players.set(client.sessionId, player);
  }

  onLeave (client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!", code);
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    /**
     * Called when the room is disposed.
     */
    console.log("room", this.roomId, "disposing...");
  }

}

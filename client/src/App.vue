<script setup>
import { ref, shallowRef } from 'vue';
import Lobby from './components/Lobby.vue'
import GameView from './components/GameView.vue'
import * as Colyseus from "@colyseus/sdk";

const client = new Colyseus.Client('ws://localhost:2567');
const currentRoom = shallowRef(null);
const gameStarted = ref(false);
const joinedParty = shallowRef(null);
const partyMembers = ref({});
const partyInviteCode = ref('');

const onRoomJoined = (room) => {
  console.log("Room synced in App:", room.id);
  currentRoom.value = room;
  
  room.onStateChange((state) => {
    if (state.gameStarted) {
      gameStarted.value = true;
    } else {
      gameStarted.value = false;
    }
  });

  room.onLeave(() => {
    currentRoom.value = null;
    gameStarted.value = false;
  });
};

const joinRoomByLeader = async (roomId, partyId) => {
  if (currentRoom.value && currentRoom.value.id === roomId) return;
  
  try {
    console.log("App: Following leader to room", roomId);
    const room = await client.joinById(roomId, { partyId });
    onRoomJoined(room);
  } catch (e) {
    console.error("App: Follow leader failed:", e);
  }
};

const handlePartyJoined = (room) => {
    joinedParty.value = room;
    
    if (room.metadata?.inviteCode) partyInviteCode.value = room.metadata.inviteCode;
    
    room.onStateChange((state) => {
        if (!state) return;
        if (state.inviteCode) partyInviteCode.value = state.inviteCode;
        
        const members = {};
        state.members.forEach((m, id) => {
            members[id] = { ready: m.ready, isLeader: m.isLeader };
        });
        partyMembers.value = members;
    });

    room.onMessage("partyInit", (data) => {
        if (data.inviteCode) partyInviteCode.value = data.inviteCode;
    });

    room.onMessage("orderLeaveGame", () => {
        console.log("App: Party Order received - Leaving Room");
        if (currentRoom.value) {
            currentRoom.value.leave();
            currentRoom.value = null;
            gameStarted.value = false;
        }
    });

    room.onMessage("startJoinGame", (data) => {
        joinRoomByLeader(data.roomId, data.partyId);
    });

    room.send("requestPartyInit");
};

const leaveRoom = () => {
  if (currentRoom.value) {
    const mySessionId = joinedParty.value?.sessionId;
    const isLeader = mySessionId && partyMembers.value[mySessionId]?.isLeader;
    
    if (isLeader && joinedParty.value) {
        console.log("App: Leader leaving - Signaling party");
        joinedParty.value.send("leaveGame");
    }

    currentRoom.value.leave();
    currentRoom.value = null;
    gameStarted.value = false;
  }
};
</script>

<template>
  <main>
    <Lobby 
        v-if="!gameStarted" 
        :client="client"
        :party="joinedParty"
        :partyMembers="partyMembers"
        :partyCode="partyInviteCode"
        :room="currentRoom"
        @roomJoined="onRoomJoined"
        @partyJoined="handlePartyJoined"
        @partyLeft="() => { joinedParty = null; partyMembers = {}; partyInviteCode = ''; }"
    />
    
    <div v-else class="game-container">
      <div class="game-hud">
        <div class="room-info">
          <span class="room-label">Battleground:</span>
          <span class="room-id">{{ currentRoom.state?.roomName || currentRoom.id }}</span>
        </div>
        <button @click="leaveRoom" class="btn-leave">Leave Battle</button>
      </div>
      
      <GameView :room="currentRoom" :party="joinedParty" @leave="leaveRoom" />
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

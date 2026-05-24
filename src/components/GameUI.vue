<template>
  <template v-if="state.phase === 'playing'">
    <!-- Resource panel -->
    <div class="resources">
      <span class="res" :class="{ low: state.resources.wood  < 2 }">🪵 {{ state.resources.wood  }}</span>
      <span class="res" :class="{ low: state.resources.stone < 2 }">🪨 {{ state.resources.stone }}</span>
      <span class="res" :class="{ low: state.resources.food  < 2 }">🌾 {{ state.resources.food  }}</span>
      <span class="res" :class="{ low: state.resources.iron  < 2 }">⚔️ {{ state.resources.iron  }}</span>
      <span class="res gold">💰 {{ state.resources.gold }}</span>
    </div>

    <!-- Mode toolbar -->
    <div class="toolbar">
      <button
        v-for="m in MODES" :key="m.id"
        :class="['mode-btn', { active: state.mode === m.id }]"
        @click="setMode(m.id)"
      >
        <span class="icon">{{ m.icon }}</span>
        <span class="lbl">{{ m.label }}</span>
        <span class="cost">{{ m.cost }}</span>
      </button>
    </div>
  </template>

  <!-- Game-over overlay -->
  <div v-if="state.phase === 'gameover'" class="gameover">
    <div class="box">
      <div class="result">{{ state.winner === 'player' ? '🏆 Victory!' : '💀 Defeat' }}</div>
      <div class="sub">
        {{ state.winner === 'player'
          ? 'You have conquered the realm.'
          : 'The enemy empire has prevailed.' }}
      </div>
      <button class="restart" @click="restart">Play Again</button>
    </div>
  </div>
</template>

<script setup>
import { state, initMap } from '../game/gameState.js'

const MODES = [
  { id: 'road',    icon: '🛤',  label: 'Road',    cost: '1🪵 1🪨'       },
  { id: 'village', icon: '🏘',  label: 'Village', cost: '2🪵 2🪨 / 3🪨 3🌾' },
  { id: 'spawn',   icon: '🗡',  label: 'Spawn',   cost: '1⚔️ 1🌾'       },
  { id: 'attack',  icon: '⚔️', label: 'Attack',  cost: '—'              },
]

function setMode(id) {
  state.mode = id
  state.selectedArmy = null
}

function restart() {
  initMap()
}
</script>

<style scoped>
.resources {
  position: fixed;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 12px;
  align-items: center;
  background: rgba(0,0,0,0.58);
  border: 1px solid rgba(255,215,0,0.25);
  border-radius: 4px;
  padding: 7px 16px;
  font: 14px monospace;
  color: rgba(255,255,255,0.9);
  z-index: 5;
}

.res.low  { color: rgba(255, 80, 80, 0.95); }
.res.gold { color: rgba(255,215,0,0.95); }

.toolbar {
  position: fixed;
  bottom: 72px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  background: rgba(0,0,0,0.62);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  padding: 6px;
  z-index: 5;
}

.mode-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 7px 16px;
  min-width: 76px;
  background: rgba(20,14,40,0.85);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 4px;
  color: rgba(255,255,255,0.82);
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
  user-select: none;
}

.mode-btn:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.45); }

.mode-btn.active {
  background: rgba(255,215,0,0.16);
  border-color: rgba(255,215,0,0.8);
  color: rgba(255,215,0,0.95);
}

.mode-btn .icon { font-size: 18px; line-height: 1; }
.mode-btn .lbl  { font: bold 11px sans-serif; }
.mode-btn .cost { font: 10px monospace; opacity: 0.6; white-space: nowrap; }

/* Game over */
.gameover {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}

.box {
  background: rgba(10,7,24,0.96);
  border: 2px solid rgba(255,215,0,0.6);
  border-radius: 8px;
  padding: 48px 72px;
  text-align: center;
}

.box .result { font: bold 38px sans-serif; color: rgba(255,215,0,0.95); margin-bottom: 10px; }
.box .sub    { font: 15px sans-serif; color: rgba(255,255,255,0.65); margin-bottom: 30px; }

.restart {
  padding: 12px 36px;
  background: rgba(255,215,0,0.12);
  border: 2px solid rgba(255,215,0,0.7);
  border-radius: 4px;
  color: rgba(255,215,0,0.95);
  font: bold 15px sans-serif;
  cursor: pointer;
  transition: background 0.12s;
}
.restart:hover { background: rgba(255,215,0,0.28); }
</style>

<template>
  <div class="game-root">
    <canvas
      ref="canvas"
      :style="{ cursor: cursor }"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseLeave"
      @click="onClick"
    />
    <button
      v-if="state.phase === 'playing'"
      class="end-turn-btn"
      @click="onEndTurn"
    >
      End Turn <span class="turn-num">· Turn {{ state.turn }}</span>
      <span class="hint">↵</span>
    </button>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import {
  state, initMap,
  placeCapital, buildRoad, placeVillage, upgradeVillage,
  spawnArmy, attack, endTurn, canAfford, COSTS,
} from '../game/gameState.js'
import { hexToPixel, hexCorners, pixelToHex, getNeighbors, HEX_SIZE } from '../game/hex.js'

const canvas = ref(null)

const BIOME_COLORS = {
  forest:    '#3a7d44',
  fields:    '#c9b84c',
  quarry:    '#8c8c8c',
  mountains: '#5a4a3a',
  goldmine:  '#d4af37',
}
const FOG_COLOR    = '#1a1a2e'
const BORDER_COLOR = 'rgba(0,0,0,0.25)'

// ── Camera ────────────────────────────────────────────────────────────────────
const camera = reactive({ x: 0, y: 0, zoom: 1 })
const MIN_ZOOM = 0.3
const MAX_ZOOM = 3.0

// ── Drag ──────────────────────────────────────────────────────────────────────
const isDragging = ref(false)
let dragMoved = false
let dragStart  = { x: 0, y: 0 }

// ── Hover ─────────────────────────────────────────────────────────────────────
const hover        = reactive({ q: null, r: null })
const hoverIsValid = ref(false)

// ── Keys ──────────────────────────────────────────────────────────────────────
const keysDown = new Set()
let animFrameId = null

// ── Cursor ────────────────────────────────────────────────────────────────────
const cursor = computed(() => {
  if (isDragging.value)                                   return 'grabbing'
  if (state.phase === 'placement' && hover.q !== null)    return 'crosshair'
  if (state.phase === 'playing'   && hoverIsValid.value)  return 'pointer'
  return 'grab'
})

// ── Redraw when mode or phase changes ─────────────────────────────────────────
watch(() => [state.mode, state.phase, state.selectedArmy], () => {
  if (hover.q !== null) hoverIsValid.value = _isValidTarget(hover.q, hover.r)
  if (canvas.value) draw()
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function screenToWorld(sx, sy) {
  const W = canvas.value.width, H = canvas.value.height
  return { x: (sx - W/2 - camera.x) / camera.zoom, y: (sy - H/2 - camera.y) / camera.zoom }
}

function drawHex(ctx, q, r) {
  const { x, y } = hexToPixel(q, r)
  const corners   = hexCorners(x, y)
  ctx.beginPath()
  ctx.moveTo(corners[0][0], corners[0][1])
  for (let i = 1; i < 6; i++) ctx.lineTo(corners[i][0], corners[i][1])
  ctx.closePath()
  return { x, y }
}

function isValidRoadTarget(q, r) {
  const key = `${q},${r}`
  if (!state.tiles.has(key) || state.roadTiles.has(key)) return false
  if (state.armies.get(key)?.owner === 'ai') return false
  for (const [nq, nr] of getNeighbors(q, r)) {
    if (state.roadTiles.has(`${nq},${nr}`)) return true
  }
  return false
}

function _isValidTarget(q, r) {
  if (state.phase !== 'playing') return false
  const key = `${q},${r}`
  if (!state.tiles.has(key)) return false
  switch (state.mode) {
    case 'road':
      return isValidRoadTarget(q, r)
    case 'village': {
      if (!state.visible.has(key)) return false
      const s = state.settlements.get(key)
      if (s) return s.owner === 'player' && s.level === 'village' && canAfford('player', COSTS.city)
      return state.roadTiles.has(key) && canAfford('player', COSTS.village)
    }
    case 'spawn':
      return state.roadTiles.has(key)
        && (!state.armies.has(key) || state.armies.get(key).owner === 'player')
        && canAfford('player', COSTS.army)
    case 'attack':
      if (!state.selectedArmy) {
        return !!(state.armies.get(key)?.owner === 'player')
      }
      if (!getNeighbors(state.selectedArmy.q, state.selectedArmy.r)
            .some(([nq, nr]) => nq === q && nr === r)) return false
      // Disallow attacking pure player territory
      const hasAiClaim = state.aiRoadTiles.has(key)
        || state.armies.get(key)?.owner === 'ai'
        || state.settlements.get(key)?.owner === 'ai'
      return hasAiClaim || !state.roadTiles.has(key)
    default: return false
  }
}

function getValidRoadTargets() {
  const out = new Set()
  for (const key of state.roadTiles) {
    const [q, r] = key.split(',').map(Number)
    for (const [nq, nr] of getNeighbors(q, r)) {
      const nk = `${nq},${nr}`
      if (state.tiles.has(nk) && !state.roadTiles.has(nk)
          && state.armies.get(nk)?.owner !== 'ai') out.add(nk)
    }
  }
  return out
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function draw() {
  const ctx = canvas.value.getContext('2d')
  const W   = canvas.value.width, H = canvas.value.height
  ctx.clearRect(0, 0, W, H)

  ctx.save()
  ctx.translate(W/2 + camera.x, H/2 + camera.y)
  ctx.scale(camera.zoom, camera.zoom)
  const iz = 1 / camera.zoom   // invZoom shorthand

  // ── 1. Tiles ────────────────────────────────────────────────────────────────
  for (const tile of state.tiles.values()) {
    drawHex(ctx, tile.q, tile.r)
    ctx.fillStyle   = state.visible.has(`${tile.q},${tile.r}`)
      ? BIOME_COLORS[tile.biome] : FOG_COLOR
    ctx.fill()
    ctx.strokeStyle = BORDER_COLOR
    ctx.lineWidth   = iz
    ctx.stroke()
  }

  // ── 2. Player roads ─────────────────────────────────────────────────────────
  ctx.lineCap = 'round'
  for (const seg of state.roads) {
    const [ak, bk] = seg.split('|')
    const [q1, r1] = ak.split(',').map(Number)
    const [q2, r2] = bk.split(',').map(Number)
    const { x: x1, y: y1 } = hexToPixel(q1, r1)
    const { x: x2, y: y2 } = hexToPixel(q2, r2)
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2)
    ctx.strokeStyle = 'rgba(160,110,30,0.9)'
    ctx.lineWidth   = 4 * iz
    ctx.stroke()
  }

  // ── 3. AI roads (visible tiles only) ────────────────────────────────────────
  for (const seg of state.aiRoads) {
    const [ak, bk] = seg.split('|')
    if (!state.visible.has(ak) && !state.visible.has(bk)) continue
    const [q1, r1] = ak.split(',').map(Number)
    const [q2, r2] = bk.split(',').map(Number)
    const { x: x1, y: y1 } = hexToPixel(q1, r1)
    const { x: x2, y: y2 } = hexToPixel(q2, r2)
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2)
    ctx.strokeStyle = 'rgba(200,50,50,0.85)'
    ctx.lineWidth   = 4 * iz
    ctx.stroke()
  }
  ctx.lineCap = 'butt'

  // ── 4. Valid road targets (road mode) ────────────────────────────────────────
  if (state.phase === 'playing' && state.mode === 'road') {
    for (const key of getValidRoadTargets()) {
      const t = state.tiles.get(key)
      drawHex(ctx, t.q, t.r)
      ctx.strokeStyle = 'rgba(255,215,0,0.28)'
      ctx.lineWidth   = 1.5 * iz
      ctx.stroke()
    }
  }

  // ── 5. Placement preview ─────────────────────────────────────────────────────
  if (state.phase === 'placement' && hover.q !== null) {
    const cq = hover.q, cr = hover.r
    for (const [pq, pr] of [[cq, cr], ...getNeighbors(cq, cr)]) {
      if (!state.tiles.has(`${pq},${pr}`)) continue
      const isCenter = pq === cq && pr === cr
      drawHex(ctx, pq, pr)
      ctx.fillStyle   = isCenter ? 'rgba(255,215,0,0.45)' : 'rgba(255,215,0,0.18)'
      ctx.fill()
      ctx.strokeStyle = isCenter ? 'rgba(255,215,0,0.9)' : 'rgba(255,215,0,0.45)'
      ctx.lineWidth   = (isCenter ? 2.5 : 1) * iz
      ctx.stroke()
    }
    const { x: hx, y: hy } = hexToPixel(cq, cr)
    ctx.fillStyle    = 'rgba(255,215,0,0.95)'
    ctx.font         = `${13 * iz}px sans-serif`
    ctx.textAlign    = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('★', hx, hy)
  }

  // ── 6. Road hover preview ────────────────────────────────────────────────────
  if (state.phase === 'playing' && state.mode === 'road'
      && hover.q !== null && hoverIsValid.value) {
    const cq = hover.q, cr = hover.r
    for (const [pq, pr] of [[cq, cr], ...getNeighbors(cq, cr)]) {
      if (!state.tiles.has(`${pq},${pr}`)) continue
      if (state.visible.has(`${pq},${pr}`)) continue
      const isCenter = pq === cq && pr === cr
      drawHex(ctx, pq, pr)
      ctx.fillStyle   = isCenter ? 'rgba(200,160,50,0.3)' : 'rgba(200,160,50,0.12)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(200,160,50,0.45)'; ctx.lineWidth = iz; ctx.stroke()
    }
    const { x: hx, y: hy } = hexToPixel(cq, cr)
    ctx.lineCap = 'round'
    ctx.setLineDash([5 * iz, 3 * iz])
    for (const [nq, nr] of getNeighbors(cq, cr)) {
      if (!state.roadTiles.has(`${nq},${nr}`)) continue
      const { x: nx, y: ny } = hexToPixel(nq, nr)
      ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(hx, hy)
      ctx.strokeStyle = 'rgba(200,155,50,0.75)'; ctx.lineWidth = 4 * iz; ctx.stroke()
    }
    ctx.setLineDash([]); ctx.lineCap = 'butt'
    drawHex(ctx, cq, cr)
    ctx.strokeStyle = 'rgba(255,215,0,0.85)'; ctx.lineWidth = 2 * iz; ctx.stroke()
  }

  // ── 7. Village mode hover preview ────────────────────────────────────────────
  if (state.phase === 'playing' && state.mode === 'village' && hover.q !== null) {
    const key = `${hover.q},${hover.r}`
    const s   = state.settlements.get(key)
    const isUpgrade = s?.owner === 'player' && s?.level === 'village'
    const isPlace   = state.roadTiles.has(key) && !s && state.visible.has(key)
    if (isUpgrade || isPlace) {
      drawHex(ctx, hover.q, hover.r)
      ctx.fillStyle   = isUpgrade ? 'rgba(255,215,0,0.25)' : 'rgba(100,220,100,0.25)'
      ctx.fill()
      ctx.strokeStyle = isUpgrade ? 'rgba(255,215,0,0.85)' : 'rgba(100,220,100,0.85)'
      ctx.lineWidth   = 2 * iz; ctx.stroke()
    }
  }

  // ── 8. Spawn mode hover preview ───────────────────────────────────────────────
  if (state.phase === 'playing' && state.mode === 'spawn' && hover.q !== null) {
    const key = `${hover.q},${hover.r}`
    const ex  = state.armies.get(key)
    if (state.roadTiles.has(key) && (!ex || ex.owner === 'player')) {
      drawHex(ctx, hover.q, hover.r)
      ctx.fillStyle   = 'rgba(50,100,220,0.25)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(80,140,255,0.85)'
      ctx.lineWidth   = 2 * iz; ctx.stroke()
    }
  }

  // ── 9. Attack mode: selected army + targets ───────────────────────────────────
  if (state.phase === 'playing' && state.mode === 'attack') {
    if (state.selectedArmy) {
      // Highlight selected army tile
      drawHex(ctx, state.selectedArmy.q, state.selectedArmy.r)
      ctx.strokeStyle = 'rgba(255,255,80,1)'; ctx.lineWidth = 3 * iz; ctx.stroke()

      // Highlight adjacent attack targets
      for (const [nq, nr] of getNeighbors(state.selectedArmy.q, state.selectedArmy.r)) {
        const nk = `${nq},${nr}`
        if (!state.tiles.has(nk)) continue
        const hasAiClaim = state.aiRoadTiles.has(nk)
          || state.armies.get(nk)?.owner === 'ai'
          || state.settlements.get(nk)?.owner === 'ai'
        const isAttackable = hasAiClaim || !state.roadTiles.has(nk)
        if (!isAttackable) continue
        drawHex(ctx, nq, nr)
        ctx.fillStyle   = 'rgba(255,30,30,0.12)'; ctx.fill()
        ctx.strokeStyle = 'rgba(255,60,60,0.8)';  ctx.lineWidth = 2 * iz; ctx.stroke()
      }
    } else if (hover.q !== null) {
      // Hover: highlight own armies as selectable
      const key = `${hover.q},${hover.r}`
      if (state.armies.get(key)?.owner === 'player') {
        drawHex(ctx, hover.q, hover.r)
        ctx.strokeStyle = 'rgba(80,140,255,0.85)'; ctx.lineWidth = 2 * iz; ctx.stroke()
      }
    }
  }

  // ── 10. Settlements (visible tiles only) ──────────────────────────────────────
  for (const [key, s] of state.settlements) {
    if (!state.visible.has(key)) continue
    const isPlayer  = s.owner === 'player'
    const isCity    = s.level === 'city'
    const isCapital = (isPlayer  && state.capital?.q  === s.q && state.capital?.r  === s.r)
                   || (!isPlayer && state.aiCapital?.q === s.q && state.aiCapital?.r === s.r)

    if (isCapital) continue   // capitals rendered separately below

    drawHex(ctx, s.q, s.r)
    ctx.strokeStyle = isPlayer
      ? (isCity ? 'rgba(255,215,0,0.95)'  : 'rgba(255,255,255,0.7)')
      : (isCity ? 'rgba(255,140,0,0.95)'  : 'rgba(220,60,60,0.7)')
    ctx.lineWidth = (isCity ? 2 : 1.5) * iz
    if (!isCity) ctx.setLineDash([3 * iz, 3 * iz])
    ctx.stroke()
    ctx.setLineDash([])

    const { x: sx, y: sy } = hexToPixel(s.q, s.r)
    ctx.fillStyle    = isPlayer
      ? (isCity ? 'rgba(255,215,0,0.95)'  : 'rgba(255,255,255,0.85)')
      : (isCity ? 'rgba(255,140,0,0.95)'  : 'rgba(220,60,60,0.85)')
    ctx.font         = `bold ${10 * iz}px sans-serif`
    ctx.textAlign    = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(isCity ? 'C' : 'V', sx, sy)
  }

  // ── 11. Armies (visible tiles only) ───────────────────────────────────────────
  for (const [key, army] of state.armies) {
    if (!state.visible.has(key)) continue
    const [q, r] = key.split(',').map(Number)
    const { x, y } = hexToPixel(q, r)
    const by = y + HEX_SIZE * 0.4
    const bw = 13 * iz, bh = 10 * iz

    ctx.fillStyle = army.owner === 'player'
      ? 'rgba(40,80,210,0.9)' : 'rgba(200,40,40,0.9)'
    ctx.fillRect(x - bw/2, by - bh/2, bw, bh)

    ctx.fillStyle    = 'white'
    ctx.font         = `bold ${8 * iz}px monospace`
    ctx.textAlign    = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(army.count, x, by)
  }

  // ── 12. Player capital marker ─────────────────────────────────────────────────
  if (state.capital) {
    const { q: cq, r: cr } = state.capital
    const { x: capX, y: capY } = drawHex(ctx, cq, cr)
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5 * iz; ctx.stroke()
    ctx.fillStyle   = 'white'
    ctx.font        = `${13 * iz}px sans-serif`
    ctx.textAlign   = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('★', capX, capY)
  }

  // ── 13. AI capital marker (visible only) ──────────────────────────────────────
  if (state.aiCapital) {
    const { q: aq, r: ar } = state.aiCapital
    const key = `${aq},${ar}`
    if (state.visible.has(key)) {
      const { x: aX, y: aY } = drawHex(ctx, aq, ar)
      ctx.strokeStyle = 'rgba(220,60,60,0.9)'; ctx.lineWidth = 2.5 * iz; ctx.stroke()
      ctx.fillStyle   = 'rgba(220,60,60,0.95)'
      ctx.font        = `${13 * iz}px sans-serif`
      ctx.textAlign   = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('★', aX, aY)
    }
  }

  ctx.restore()

  // ── HUD ──────────────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(10, 10, 290, 68)
  ctx.font = '12px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillText('Pan:  drag  or  WASD / ←→↑↓', 16, 16)
  ctx.fillText('Zoom: scroll · +/−   Space: home', 16, 32)

  if (state.phase === 'placement') {
    ctx.fillStyle = 'rgba(255,215,0,0.95)'
    ctx.fillText('Click a tile to place your Capital', 16, 48)
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillText(`Turn: ${state.turn}    Zoom: ${(camera.zoom*100).toFixed(0)}%`, 16, 48)
  }

  // Placement banner
  if (state.phase === 'placement') {
    const msg = '✦  Choose a starting location for your Capital Village  ✦'
    ctx.font = 'bold 15px sans-serif'
    const tw = ctx.measureText(msg).width
    const bx = W/2 - tw/2 - 18, by = H - 60
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(bx, by, tw + 36, 42)
    ctx.strokeStyle = 'rgba(255,215,0,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, tw + 36, 42)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(0,0,0,0.7)';          ctx.fillText(msg, W/2 + 1, by + 22)
    ctx.fillStyle = 'rgba(255,215,0,0.95)';      ctx.fillText(msg, W/2,     by + 21)
  }
}

// ── Camera loop ───────────────────────────────────────────────────────────────
function tick() {
  const step = 8 / camera.zoom
  let moved = false
  if (keysDown.has('ArrowLeft')  || keysDown.has('KeyA')) { camera.x += step; moved = true }
  if (keysDown.has('ArrowRight') || keysDown.has('KeyD')) { camera.x -= step; moved = true }
  if (keysDown.has('ArrowUp')    || keysDown.has('KeyW')) { camera.y += step; moved = true }
  if (keysDown.has('ArrowDown')  || keysDown.has('KeyS')) { camera.y -= step; moved = true }
  if (moved) draw()
  animFrameId = requestAnimationFrame(tick)
}

function applyZoom(factor, pivotX, pivotY) {
  const W = canvas.value.width, H = canvas.value.height
  const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor))
  const scale   = newZoom / camera.zoom
  camera.x = camera.x * scale + (pivotX - W/2) * (1 - scale)
  camera.y = camera.y * scale + (pivotY - H/2) * (1 - scale)
  camera.zoom = newZoom
  draw()
}

// ── Mouse handlers ────────────────────────────────────────────────────────────
function onMouseDown(e) {
  isDragging.value = true; dragMoved = false
  dragStart = { x: e.clientX, y: e.clientY }
}

function onMouseMove(e) {
  if (isDragging.value) {
    const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true
    camera.x += dx; camera.y += dy
    dragStart = { x: e.clientX, y: e.clientY }
    draw(); return
  }
  const rect   = canvas.value.getBoundingClientRect()
  const { x: wx, y: wy } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
  const [q, r] = pixelToHex(wx, wy)
  if (state.tiles.has(`${q},${r}`)) {
    hover.q = q; hover.r = r
    hoverIsValid.value = state.phase === 'playing' ? _isValidTarget(q, r) : true
  } else {
    hover.q = null; hover.r = null; hoverIsValid.value = false
  }
  draw()
}

function onMouseUp() { isDragging.value = false }

function onMouseLeave() {
  isDragging.value = false
  hover.q = null; hover.r = null; hoverIsValid.value = false
  draw()
}

function onClick(e) {
  if (dragMoved) { dragMoved = false; return }
  const rect   = canvas.value.getBoundingClientRect()
  const { x: wx, y: wy } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
  const [q, r] = pixelToHex(wx, wy)

  if (state.phase === 'placement') {
    if (placeCapital(q, r)) { hover.q = null; hover.r = null; hoverIsValid.value = false }
  } else if (state.phase === 'playing') {
    const key = `${q},${r}`
    switch (state.mode) {
      case 'road':
        buildRoad(q, r)
        break
      case 'village': {
        const s = state.settlements.get(key)
        if (s && s.owner === 'player' && s.level === 'village') upgradeVillage(q, r)
        else placeVillage(q, r)
        break
      }
      case 'spawn':
        spawnArmy('player', q, r, 1)
        break
      case 'attack':
        if (state.selectedArmy) {
          attack(state.selectedArmy.q, state.selectedArmy.r, q, r)
        } else if (state.armies.get(key)?.owner === 'player') {
          state.selectedArmy = { q, r }
        }
        break
    }
    if (hover.q !== null) hoverIsValid.value = _isValidTarget(hover.q, hover.r)
  }
  draw()
}

function onEndTurn() { endTurn(); draw() }

function onWheel(e) {
  e.preventDefault()
  const rect   = canvas.value.getBoundingClientRect()
  applyZoom(e.deltaY < 0 ? 1.1 : 1/1.1, e.clientX - rect.left, e.clientY - rect.top)
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
function onKeyDown(e) {
  keysDown.add(e.code)
  if (e.code === 'Equal'  || e.code === 'NumpadAdd')      { e.preventDefault(); applyZoom(1.15, canvas.value.width/2, canvas.value.height/2) }
  if (e.code === 'Minus'  || e.code === 'NumpadSubtract') { e.preventDefault(); applyZoom(1/1.15, canvas.value.width/2, canvas.value.height/2) }
  if (e.code === 'Space')  { e.preventDefault(); camera.x = 0; camera.y = 0; camera.zoom = 1; draw() }
  if (e.code === 'Enter'  || e.code === 'NumpadEnter')    { e.preventDefault(); onEndTurn() }
  if (e.code === 'Escape') { state.selectedArmy = null; draw() }
}
function onKeyUp(e) { keysDown.delete(e.code) }

// ── Lifecycle ─────────────────────────────────────────────────────────────────
function resize() {
  canvas.value.width  = window.innerWidth
  canvas.value.height = window.innerHeight
  draw()
}

onMounted(() => {
  initMap(); resize()
  window.addEventListener('resize',  resize)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup',   onKeyUp)
  canvas.value.addEventListener('wheel', onWheel, { passive: false })
  animFrameId = requestAnimationFrame(tick)
})

onUnmounted(() => {
  window.removeEventListener('resize',  resize)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup',   onKeyUp)
  canvas.value?.removeEventListener('wheel', onWheel)
  cancelAnimationFrame(animFrameId)
})
</script>

<style scoped>
.game-root {
  position: relative;
  width: 100%;
  height: 100%;
}

.end-turn-btn {
  position: absolute;
  bottom: 24px;
  right: 24px;
  padding: 10px 22px;
  background: rgba(13,10,30,0.88);
  border: 2px solid rgba(255,215,0,0.65);
  border-radius: 4px;
  color: rgba(255,215,0,0.95);
  font: bold 15px sans-serif;
  letter-spacing: 0.4px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
  user-select: none;
}
.end-turn-btn:hover  { background: rgba(255,215,0,0.12); border-color: rgba(255,215,0,1); }
.end-turn-btn:active { background: rgba(255,215,0,0.22); }
.end-turn-btn .turn-num { opacity: 0.75; font-weight: normal; }
.end-turn-btn .hint     { margin-left: 8px; opacity: 0.45; font-size: 13px; font-weight: normal; }
</style>

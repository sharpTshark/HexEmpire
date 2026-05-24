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
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { state, initMap, placeCapital, buildRoad, endTurn } from '../game/gameState.js'
import { hexToPixel, hexCorners, pixelToHex, getNeighbors } from '../game/hex.js'

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

// ── Drag state ────────────────────────────────────────────────────────────────
const isDragging = ref(false)
let dragMoved = false
let dragStart  = { x: 0, y: 0 }

// ── Hover — used for placement preview and road-building preview ──────────────
const hover        = reactive({ q: null, r: null })
const hoverIsValid = ref(false)   // true when hover is a valid road target

// ── Keyboard state ────────────────────────────────────────────────────────────
const keysDown = new Set()
let animFrameId = null

// ── Cursor ────────────────────────────────────────────────────────────────────
const cursor = computed(() => {
  if (isDragging.value)                                   return 'grabbing'
  if (state.phase === 'placement' && hover.q !== null)    return 'crosshair'
  if (state.phase === 'playing'   && hoverIsValid.value)  return 'pointer'
  return 'grab'
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function screenToWorld(sx, sy) {
  const W = canvas.value.width
  const H = canvas.value.height
  return {
    x: (sx - W / 2 - camera.x) / camera.zoom,
    y: (sy - H / 2 - camera.y) / camera.zoom,
  }
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
  for (const [nq, nr] of getNeighbors(q, r)) {
    if (state.roadTiles.has(`${nq},${nr}`)) return true
  }
  return false
}

function getValidRoadTargets() {
  const out = new Set()
  for (const key of state.roadTiles) {
    const [q, r] = key.split(',').map(Number)
    for (const [nq, nr] of getNeighbors(q, r)) {
      const nk = `${nq},${nr}`
      if (state.tiles.has(nk) && !state.roadTiles.has(nk)) out.add(nk)
    }
  }
  return out
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function draw() {
  const ctx = canvas.value.getContext('2d')
  const W   = canvas.value.width
  const H   = canvas.value.height
  ctx.clearRect(0, 0, W, H)

  ctx.save()
  ctx.translate(W / 2 + camera.x, H / 2 + camera.y)
  ctx.scale(camera.zoom, camera.zoom)

  const invZoom = 1 / camera.zoom

  // 1. All tiles (fog or biome color)
  for (const tile of state.tiles.values()) {
    drawHex(ctx, tile.q, tile.r)
    ctx.fillStyle   = state.visible.has(`${tile.q},${tile.r}`) ? BIOME_COLORS[tile.biome] : FOG_COLOR
    ctx.fill()
    ctx.strokeStyle = BORDER_COLOR
    ctx.lineWidth   = invZoom
    ctx.stroke()
  }

  // 2. Road segments — brown lines between connected road-tile centers
  ctx.lineCap = 'round'
  for (const seg of state.roads) {
    const [ak, bk]   = seg.split('|')
    const [q1, r1]   = ak.split(',').map(Number)
    const [q2, r2]   = bk.split(',').map(Number)
    const { x: x1, y: y1 } = hexToPixel(q1, r1)
    const { x: x2, y: y2 } = hexToPixel(q2, r2)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.strokeStyle = 'rgba(160, 110, 30, 0.9)'
    ctx.lineWidth   = 4 * invZoom
    ctx.stroke()
  }
  ctx.lineCap = 'butt'

  // 3. Valid road targets — faint gold ring so the player knows where to expand
  if (state.phase === 'playing') {
    for (const key of getValidRoadTargets()) {
      const t = state.tiles.get(key)
      drawHex(ctx, t.q, t.r)
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.28)'
      ctx.lineWidth   = 1.5 * invZoom
      ctx.stroke()
    }
  }

  // 4. Placement preview — golden highlight on hover tile + its 6 neighbors
  if (state.phase === 'placement' && hover.q !== null) {
    const cq = hover.q, cr = hover.r
    for (const [pq, pr] of [[cq, cr], ...getNeighbors(cq, cr)]) {
      if (!state.tiles.has(`${pq},${pr}`)) continue
      const isCenter = pq === cq && pr === cr
      drawHex(ctx, pq, pr)
      ctx.fillStyle   = isCenter ? 'rgba(255,215,0,0.45)' : 'rgba(255,215,0,0.18)'
      ctx.fill()
      ctx.strokeStyle = isCenter ? 'rgba(255,215,0,0.9)' : 'rgba(255,215,0,0.45)'
      ctx.lineWidth   = (isCenter ? 2.5 : 1) * invZoom
      ctx.stroke()
    }
    const { x: hx, y: hy } = hexToPixel(cq, cr)
    ctx.fillStyle    = 'rgba(255,215,0,0.95)'
    ctx.font         = `${13 * invZoom}px sans-serif`
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('★', hx, hy)
  }

  // 5. Road hover preview (playing phase)
  if (state.phase === 'playing' && hover.q !== null && hoverIsValid.value) {
    const cq = hover.q, cr = hover.r

    // a. Fog reveal preview — show which tiles would be uncovered
    for (const [pq, pr] of [[cq, cr], ...getNeighbors(cq, cr)]) {
      if (!state.tiles.has(`${pq},${pr}`)) continue
      if (state.visible.has(`${pq},${pr}`)) continue
      const isCenter = pq === cq && pr === cr
      drawHex(ctx, pq, pr)
      ctx.fillStyle   = isCenter ? 'rgba(200,160,50,0.3)' : 'rgba(200,160,50,0.12)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(200,160,50,0.45)'
      ctx.lineWidth   = invZoom
      ctx.stroke()
    }

    // b. Dashed road preview — one dashed line per adjacent road tile
    const { x: hx, y: hy } = hexToPixel(cq, cr)
    ctx.lineCap = 'round'
    ctx.setLineDash([5 * invZoom, 3 * invZoom])
    for (const [nq, nr] of getNeighbors(cq, cr)) {
      if (!state.roadTiles.has(`${nq},${nr}`)) continue
      const { x: nx, y: ny } = hexToPixel(nq, nr)
      ctx.beginPath()
      ctx.moveTo(nx, ny)
      ctx.lineTo(hx, hy)
      ctx.strokeStyle = 'rgba(200, 155, 50, 0.75)'
      ctx.lineWidth   = 4 * invZoom
      ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.lineCap = 'butt'

    // c. Gold border on the hovered tile itself
    drawHex(ctx, cq, cr)
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.85)'
    ctx.lineWidth   = 2 * invZoom
    ctx.stroke()
  }

  // 6. Capital marker (once placed)
  if (state.capital) {
    const { q: cq, r: cr } = state.capital
    const { x: capX, y: capY } = drawHex(ctx, cq, cr)
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth   = 2.5 * invZoom
    ctx.stroke()
    ctx.fillStyle    = 'white'
    ctx.font         = `${13 * invZoom}px sans-serif`
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('★', capX, capY)
  }

  ctx.restore()

  // ── HUD (screen-space) ────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(10, 10, 290, 68)
  ctx.font         = '12px monospace'
  ctx.textAlign    = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle    = 'rgba(255,255,255,0.85)'
  ctx.fillText('Pan:  drag  or  WASD / ←→↑↓', 16, 16)
  ctx.fillText('Zoom: scroll · +/−   Space: home', 16, 32)

  if (state.phase === 'placement') {
    ctx.fillStyle = 'rgba(255,215,0,0.95)'
    ctx.fillText('Click a tile to place your Capital', 16, 48)
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillText(`Turn: ${state.turn}    Zoom: ${(camera.zoom * 100).toFixed(0)}%`, 16, 48)
  }

  // ── Placement banner (centered, bottom of screen) ─────────────────────────
  if (state.phase === 'placement') {
    const msg = '✦  Choose a starting location for your Capital Village  ✦'
    ctx.font         = 'bold 15px sans-serif'
    const tw         = ctx.measureText(msg).width
    const bx         = W / 2 - tw / 2 - 18
    const by         = H - 60

    ctx.fillStyle    = 'rgba(0,0,0,0.65)'
    ctx.fillRect(bx, by, tw + 36, 42)
    ctx.strokeStyle  = 'rgba(255,215,0,0.5)'
    ctx.lineWidth    = 1
    ctx.strokeRect(bx, by, tw + 36, 42)

    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle    = 'rgba(0,0,0,0.7)'
    ctx.fillText(msg, W / 2 + 1, by + 22)
    ctx.fillStyle    = 'rgba(255,215,0,0.95)'
    ctx.fillText(msg, W / 2, by + 21)
  }
}

// ── Camera animation loop ─────────────────────────────────────────────────────
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
  const W       = canvas.value.width
  const H       = canvas.value.height
  const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor))
  const scale   = newZoom / camera.zoom
  camera.x      = camera.x * scale + (pivotX - W / 2) * (1 - scale)
  camera.y      = camera.y * scale + (pivotY - H / 2) * (1 - scale)
  camera.zoom   = newZoom
  draw()
}

// ── Mouse handlers ─────────────────────────────────────────────────────────────
function onMouseDown(e) {
  isDragging.value = true
  dragMoved        = false
  dragStart        = { x: e.clientX, y: e.clientY }
}

function onMouseMove(e) {
  if (isDragging.value) {
    const dx = e.clientX - dragStart.x
    const dy = e.clientY - dragStart.y
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true
    camera.x  += dx
    camera.y  += dy
    dragStart  = { x: e.clientX, y: e.clientY }
    draw()
    return
  }

  // Track hover for placement preview and road-building preview
  const rect   = canvas.value.getBoundingClientRect()
  const { x: wx, y: wy } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
  const [q, r] = pixelToHex(wx, wy)
  if (state.tiles.has(`${q},${r}`)) {
    hover.q = q; hover.r = r
    hoverIsValid.value = state.phase === 'playing' ? isValidRoadTarget(q, r) : true
  } else {
    hover.q = null; hover.r = null; hoverIsValid.value = false
  }
  draw()
}

function onMouseUp() {
  isDragging.value = false
}

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
    if (placeCapital(q, r)) {
      hover.q = null; hover.r = null; hoverIsValid.value = false
    }
  } else if (state.phase === 'playing') {
    buildRoad(q, r)
    // Re-evaluate validity — the tile just built is now in roadTiles
    if (hover.q !== null) hoverIsValid.value = isValidRoadTarget(hover.q, hover.r)
  }
  draw()
}

function onEndTurn() {
  endTurn()
  draw()
}

function onWheel(e) {
  e.preventDefault()
  const rect   = canvas.value.getBoundingClientRect()
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
  applyZoom(factor, e.clientX - rect.left, e.clientY - rect.top)
}

// ── Keyboard handlers ──────────────────────────────────────────────────────────
function onKeyDown(e) {
  keysDown.add(e.code)

  if (e.code === 'Equal' || e.code === 'NumpadAdd') {
    e.preventDefault()
    applyZoom(1.15, canvas.value.width / 2, canvas.value.height / 2)
  }
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
    e.preventDefault()
    applyZoom(1 / 1.15, canvas.value.width / 2, canvas.value.height / 2)
  }
  if (e.code === 'Space') {
    e.preventDefault()
    camera.x = 0; camera.y = 0; camera.zoom = 1
    draw()
  }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    e.preventDefault()
    onEndTurn()
  }
}

function onKeyUp(e) {
  keysDown.delete(e.code)
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────
function resize() {
  canvas.value.width  = window.innerWidth
  canvas.value.height = window.innerHeight
  draw()
}

onMounted(() => {
  initMap()
  resize()
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
  background: rgba(13, 10, 30, 0.88);
  border: 2px solid rgba(255, 215, 0, 0.65);
  border-radius: 4px;
  color: rgba(255, 215, 0, 0.95);
  font: bold 15px sans-serif;
  letter-spacing: 0.4px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
  user-select: none;
}

.end-turn-btn:hover {
  background: rgba(255, 215, 0, 0.12);
  border-color: rgba(255, 215, 0, 1);
}

.end-turn-btn:active {
  background: rgba(255, 215, 0, 0.22);
}

.end-turn-btn .turn-num {
  opacity: 0.75;
  font-weight: normal;
}

.end-turn-btn .hint {
  margin-left: 8px;
  opacity: 0.45;
  font-size: 13px;
  font-weight: normal;
}
</style>

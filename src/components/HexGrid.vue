<template>
  <canvas
    ref="canvas"
    :style="{ cursor: isDragging ? 'grabbing' : 'grab' }"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
    @mouseleave="onMouseUp"
    @click="onClick"
  />
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { state, initMap, revealTile } from '../game/gameState.js'
import { hexToPixel, hexCorners, pixelToHex } from '../game/hex.js'

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

// ── Keyboard state ────────────────────────────────────────────────────────────
const keysDown = new Set()
let animFrameId = null

// ── Rendering ─────────────────────────────────────────────────────────────────
function draw() {
  const ctx = canvas.value.getContext('2d')
  const W = canvas.value.width
  const H = canvas.value.height
  ctx.clearRect(0, 0, W, H)

  // Apply camera transform: world origin → screen center + camera offset + zoom
  ctx.save()
  ctx.translate(W / 2 + camera.x, H / 2 + camera.y)
  ctx.scale(camera.zoom, camera.zoom)

  const invZoom = 1 / camera.zoom

  // Draw all tiles
  for (const tile of state.tiles.values()) {
    const { x, y } = hexToPixel(tile.q, tile.r)
    const corners   = hexCorners(x, y)
    const visible   = state.visible.has(`${tile.q},${tile.r}`)

    ctx.beginPath()
    ctx.moveTo(corners[0][0], corners[0][1])
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i][0], corners[i][1])
    ctx.closePath()

    ctx.fillStyle   = visible ? BIOME_COLORS[tile.biome] : FOG_COLOR
    ctx.fill()
    ctx.strokeStyle = BORDER_COLOR
    ctx.lineWidth   = invZoom
    ctx.stroke()
  }

  // Capital marker — white ring + star
  const { q: cq, r: cr } = state.capital
  const { x: capX, y: capY } = hexToPixel(cq, cr)
  const capCorners = hexCorners(capX, capY)
  ctx.beginPath()
  ctx.moveTo(capCorners[0][0], capCorners[0][1])
  for (let i = 1; i < 6; i++) ctx.lineTo(capCorners[i][0], capCorners[i][1])
  ctx.closePath()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth   = 2.5 * invZoom
  ctx.stroke()

  ctx.fillStyle    = 'white'
  ctx.font         = `${13 * invZoom}px sans-serif`
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('★', capX, capY)

  ctx.restore()

  // ── HUD (screen-space, unaffected by camera) ──────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(10, 10, 230, 70)
  ctx.fillStyle    = 'rgba(255,255,255,0.85)'
  ctx.font         = '12px monospace'
  ctx.textAlign    = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('Pan:  drag  or  WASD / ← → ↑ ↓', 16, 16)
  ctx.fillText('Zoom: scroll  or  +  /  −  (Space: reset)', 16, 32)
  ctx.fillText(`Zoom: ${(camera.zoom * 100).toFixed(0)}%    Click fog to reveal`, 16, 48)
}

// ── Keyboard-driven smooth pan ─────────────────────────────────────────────────
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

// ── Mouse handlers ─────────────────────────────────────────────────────────────
function onMouseDown(e) {
  isDragging.value = true
  dragMoved        = false
  dragStart        = { x: e.clientX, y: e.clientY }
}

function onMouseMove(e) {
  if (!isDragging.value) return
  const dx = e.clientX - dragStart.x
  const dy = e.clientY - dragStart.y
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true
  camera.x  += dx
  camera.y  += dy
  dragStart  = { x: e.clientX, y: e.clientY }
  draw()
}

function onMouseUp() {
  isDragging.value = false
}

function onClick(e) {
  if (dragMoved) { dragMoved = false; return }
  const W    = canvas.value.width
  const H    = canvas.value.height
  const rect = canvas.value.getBoundingClientRect()
  // Screen → world coordinates
  const wx = (e.clientX - rect.left  - W / 2 - camera.x) / camera.zoom
  const wy = (e.clientY - rect.top   - H / 2 - camera.y) / camera.zoom
  const [q, r] = pixelToHex(wx, wy)
  revealTile(q, r)
  draw()
}

function applyZoom(factor, pivotX, pivotY) {
  const W       = canvas.value.width
  const H       = canvas.value.height
  const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor))
  const scale   = newZoom / camera.zoom
  // Keep world point under pivot fixed on screen
  camera.x    = camera.x * scale + (pivotX - W / 2) * (1 - scale)
  camera.y    = camera.y * scale + (pivotY - H / 2) * (1 - scale)
  camera.zoom = newZoom
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

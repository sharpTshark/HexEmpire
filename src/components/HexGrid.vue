<template>
  <canvas ref="canvas" />
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { state, initMap } from '../game/gameState.js'
import { hexToPixel, hexCorners } from '../game/hex.js'

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

function draw() {
  const ctx = canvas.value.getContext('2d')
  const W = canvas.value.width
  const H = canvas.value.height
  ctx.clearRect(0, 0, W, H)

  const originX = W / 2
  const originY = H / 2

  for (const tile of state.tiles.values()) {
    const { x, y } = hexToPixel(tile.q, tile.r)
    const corners = hexCorners(originX + x, originY + y)
    const key = `${tile.q},${tile.r}`

    ctx.beginPath()
    ctx.moveTo(corners[0][0], corners[0][1])
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i][0], corners[i][1])
    ctx.closePath()

    ctx.fillStyle = state.visible.has(key) ? BIOME_COLORS[tile.biome] : FOG_COLOR
    ctx.fill()
    ctx.strokeStyle = BORDER_COLOR
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

function resize() {
  canvas.value.width  = window.innerWidth
  canvas.value.height = window.innerHeight
  draw()
}

onMounted(() => {
  initMap()
  resize()
  window.addEventListener('resize', resize)
})

onUnmounted(() => {
  window.removeEventListener('resize', resize)
})
</script>

import { reactive } from 'vue'
import { hexesInRadius, getNeighbors } from './hex.js'
import { generateBiomes } from './biomeGen.js'

export const state = reactive({
  mapRadius: 10,
  seed: 42,
  capital: null,          // null until the player places it
  phase: 'placement',     // 'placement' | 'playing'
  tiles: new Map(),
  visible: new Set(),
})

// Permanently reveal a tile and its immediate neighbors (called when a road enters the tile)
export function revealTile(q, r) {
  const key = `${q},${r}`
  if (!state.tiles.has(key)) return
  state.visible.add(key)
  for (const [nq, nr] of getNeighbors(q, r)) {
    const nk = `${nq},${nr}`
    if (state.tiles.has(nk)) state.visible.add(nk)
  }
}

// Place the Capital Village, reveal its starting area, and enter the playing phase
export function placeCapital(q, r) {
  if (!state.tiles.has(`${q},${r}`)) return false
  state.capital = { q, r }
  state.phase   = 'playing'
  revealTile(q, r)
  return true
}

export function initMap() {
  state.tiles.clear()
  state.visible.clear()
  state.capital = null
  state.phase   = 'placement'

  for (const [q, r] of hexesInRadius(state.mapRadius)) {
    state.tiles.set(`${q},${r}`, { q, r, biome: null })
  }

  generateBiomes(state.tiles, state.seed)
  // No initial visibility — the player chooses where to place their Capital first
}

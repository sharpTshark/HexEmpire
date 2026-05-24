import { reactive } from 'vue'
import { hexesInRadius, getNeighbors } from './hex.js'
import { generateBiomes } from './biomeGen.js'

export const state = reactive({
  mapRadius: 10,
  seed: 42,
  capital: { q: 0, r: 0 },
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

export function initMap() {
  state.tiles.clear()
  state.visible.clear()

  for (const [q, r] of hexesInRadius(state.mapRadius)) {
    state.tiles.set(`${q},${r}`, { q, r, biome: null })
  }

  generateBiomes(state.tiles, state.seed)

  const { q, r } = state.capital
  state.visible.add(`${q},${r}`)
  for (const [nq, nr] of getNeighbors(q, r)) {
    if (state.tiles.has(`${nq},${nr}`)) state.visible.add(`${nq},${nr}`)
  }
}

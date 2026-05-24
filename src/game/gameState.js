import { reactive } from 'vue'
import { hexesInRadius, getNeighbors } from './hex.js'
import { generateBiomes } from './biomeGen.js'

export const state = reactive({
  mapRadius: 10,
  seed: 42,
  capital: null,          // null until the player places it
  phase: 'placement',     // 'placement' | 'playing'
  turn: 1,
  tiles: new Map(),
  visible: new Set(),
  roadTiles: new Set(),   // hex keys that belong to the road network
  roads: new Set(),       // canonical segment strings "q1,r1|q2,r2"
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
  state.roadTiles.add(`${q},${r}`)   // capital is the root of the road network
  revealTile(q, r)
  return true
}

// Extend the road network to an adjacent tile, lifting fog as it goes
export function buildRoad(q, r) {
  const key = `${q},${r}`
  if (!state.tiles.has(key) || state.roadTiles.has(key)) return false

  const adjacentRoad = getNeighbors(q, r).filter(([nq, nr]) =>
    state.roadTiles.has(`${nq},${nr}`)
  )
  if (adjacentRoad.length === 0) return false

  state.roadTiles.add(key)
  for (const [nq, nr] of adjacentRoad) {
    const [a, b] = [key, `${nq},${nr}`].sort()
    state.roads.add(`${a}|${b}`)
  }
  revealTile(q, r)
  return true
}

export function endTurn() {
  if (state.phase !== 'playing') return
  state.turn++
}

export function initMap() {
  state.tiles.clear()
  state.visible.clear()
  state.capital = null
  state.phase   = 'placement'
  state.turn    = 1
  state.roadTiles.clear()
  state.roads.clear()

  for (const [q, r] of hexesInRadius(state.mapRadius)) {
    state.tiles.set(`${q},${r}`, { q, r, biome: null })
  }

  generateBiomes(state.tiles, state.seed)
  // No initial visibility — the player chooses where to place their Capital first
}

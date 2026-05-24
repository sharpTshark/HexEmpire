import { reactive } from 'vue'
import { hexesInRadius, getNeighbors } from './hex.js'
import { generateBiomes } from './biomeGen.js'

// ── Constants ──────────────────────────────────────────────────────────────────

export const VISION_RADIUS = 3   // tiles revealed around each road/village

export const COSTS = {
  road:    { wood: 1, stone: 1 },
  village: { wood: 2, stone: 2 },
  city:    { stone: 3, food: 3 },
  army:    { iron: 1, food: 1 },   // per token
}

const BIOME_YIELD = {
  forest:    'wood',
  fields:    'food',
  quarry:    'stone',
  mountains: 'iron',
  goldmine:  'gold',
}

const TERRAIN_DEFENSE = { mountains: 1 }

function makeRes(wood = 0, stone = 0, food = 0, iron = 0, gold = 0) {
  return { wood, stone, food, iron, gold }
}

// ── State ──────────────────────────────────────────────────────────────────────

export const state = reactive({
  mapRadius: 10,
  seed: 42,
  phase: 'placement',     // 'placement' | 'playing' | 'gameover'
  turn: 1,
  winner: null,           // null | 'player' | 'ai'
  mode: 'road',           // 'road' | 'village' | 'spawn' | 'attack'
  selectedArmy: null,     // { q, r } | null

  tiles:   new Map(),
  visible: new Set(),     // player-explored tiles

  // Player faction
  capital:   null,
  roadTiles: new Set(),
  roads:     new Set(),
  resources: makeRes(10, 10, 10, 5, 0),

  // AI faction
  aiCapital:   null,
  aiRoadTiles: new Set(),
  aiRoads:     new Set(),
  aiResources: makeRes(10, 10, 10, 5, 0),

  // Shared objects — ownership tracked inside each entry
  settlements: new Map(), // "q,r" → { q, r, level:'village'|'city', owner:'player'|'ai' }
  armies:      new Map(), // "q,r" → { count:Number, owner:'player'|'ai' }
})

// ── Utilities ──────────────────────────────────────────────────────────────────

export function canAfford(owner, cost) {
  const r = owner === 'player' ? state.resources : state.aiResources
  return Object.entries(cost).every(([k, v]) => (r[k] ?? 0) >= v)
}

function spend(owner, cost) {
  const r = owner === 'player' ? state.resources : state.aiResources
  for (const [k, v] of Object.entries(cost)) r[k] -= v
}

function rtOf(owner) { return owner === 'player' ? state.roadTiles : state.aiRoadTiles }
function rsOf(owner) { return owner === 'player' ? state.roads     : state.aiRoads     }

// ── Init ───────────────────────────────────────────────────────────────────────

export function initMap() {
  state.tiles.clear(); state.visible.clear()
  state.roadTiles.clear(); state.roads.clear()
  state.aiRoadTiles.clear(); state.aiRoads.clear()
  state.settlements.clear(); state.armies.clear()
  Object.assign(state, {
    phase: 'placement', turn: 1, winner: null, mode: 'road', selectedArmy: null,
    capital: null, aiCapital: null,
    resources:   makeRes(10, 10, 10, 5, 0),
    aiResources: makeRes(10, 10, 10, 5, 0),
  })
  for (const [q, r] of hexesInRadius(state.mapRadius))
    state.tiles.set(`${q},${r}`, { q, r, biome: null })
  generateBiomes(state.tiles, state.seed)
}

// ── Fog of war ─────────────────────────────────────────────────────────────────

export function revealTile(q, r) {
  if (!state.tiles.has(`${q},${r}`)) return
  for (const [dq, dr] of hexesInRadius(VISION_RADIUS)) {
    const nk = `${q + dq},${r + dr}`
    if (state.tiles.has(nk)) state.visible.add(nk)
  }
}

// ── Capital placement ──────────────────────────────────────────────────────────

export function placeCapital(q, r) {
  const key = `${q},${r}`
  if (!state.tiles.has(key)) return false
  state.capital = { q, r }
  state.phase   = 'playing'
  state.roadTiles.add(key)
  state.settlements.set(key, { q, r, level: 'village', owner: 'player' })
  revealTile(q, r)
  _placeAiCapital(q, r)
  return true
}

function _placeAiCapital(pq, pr) {
  const [aq, ar] = _findAiStart(pq, pr)
  const key = `${aq},${ar}`
  state.aiCapital = { q: aq, r: ar }
  state.aiRoadTiles.add(key)
  state.settlements.set(key, { q: aq, r: ar, level: 'village', owner: 'ai' })
}

function _findAiStart(pq, pr) {
  // BFS from antipodal point to find nearest valid tile
  const visited = new Set()
  const queue   = [[-pq, -pr]]
  while (queue.length) {
    const [q, r] = queue.shift()
    const key = `${q},${r}`
    if (visited.has(key)) continue
    visited.add(key)
    if (state.tiles.has(key) && !state.settlements.has(key)) return [q, r]
    for (const n of getNeighbors(q, r)) queue.push(n)
  }
  return [-pq, -pr]
}

// ── Road building ──────────────────────────────────────────────────────────────

export function buildRoad(q, r)   { return _buildRoad('player', q, r) }

function _buildRoad(owner, q, r) {
  const key = `${q},${r}`
  const rt  = rtOf(owner)
  if (!state.tiles.has(key) || rt.has(key)) return false
  if (!canAfford(owner, COSTS.road)) return false
  // Can't build on tiles held by the enemy
  const enemy = owner === 'player' ? 'ai' : 'player'
  if (state.armies.get(key)?.owner === enemy) return false
  const adj = getNeighbors(q, r).filter(([nq, nr]) => rt.has(`${nq},${nr}`))
  if (!adj.length) return false
  spend(owner, COSTS.road)
  rt.add(key)
  const rs = rsOf(owner)
  for (const [nq, nr] of adj) {
    const [a, b] = [key, `${nq},${nr}`].sort()
    rs.add(`${a}|${b}`)
  }
  if (owner === 'player') revealTile(q, r)
  return true
}

// ── Village & City ─────────────────────────────────────────────────────────────

export function placeVillage(q, r) {
  const key = `${q},${r}`
  if (!state.roadTiles.has(key) || state.settlements.has(key)) return false
  if (!canAfford('player', COSTS.village)) return false
  spend('player', COSTS.village)
  state.settlements.set(key, { q, r, level: 'village', owner: 'player' })
  return true
}

export function upgradeVillage(q, r) {
  const s = state.settlements.get(`${q},${r}`)
  if (!s || s.owner !== 'player' || s.level !== 'village') return false
  if (!canAfford('player', COSTS.city)) return false
  spend('player', COSTS.city)
  s.level = 'city'
  return true
}

// ── Armies ─────────────────────────────────────────────────────────────────────

export function spawnArmy(owner, q, r, count = 1) {
  const key = `${q},${r}`
  if (!rtOf(owner).has(key)) return false
  const cost = { iron: COSTS.army.iron * count, food: COSTS.army.food * count }
  if (!canAfford(owner, cost)) return false
  const ex = state.armies.get(key)
  if (ex && ex.owner !== owner) return false
  spend(owner, cost)
  if (ex) ex.count += count
  else state.armies.set(key, { count, owner })
  return true
}

// ── Combat ─────────────────────────────────────────────────────────────────────

function _resolve(attackerKey, defenderKey, attackerOwner) {
  const defenderOwner = attackerOwner === 'player' ? 'ai' : 'player'
  const att = state.armies.get(attackerKey)
  if (!att || att.owner !== attackerOwner) return

  const defArmy  = state.armies.get(defenderKey)
  const defCount = (defArmy?.owner === defenderOwner) ? defArmy.count : 0
  const tile     = state.tiles.get(defenderKey)
  const bonus    = TERRAIN_DEFENSE[tile?.biome] ?? 0
  const totalDef = defCount + bonus

  if (att.count > totalDef) {
    const remaining = att.count - totalDef
    state.armies.delete(attackerKey)
    state.armies.set(defenderKey, { count: remaining, owner: attackerOwner })
    const s = state.settlements.get(defenderKey)
    if (s && s.owner === defenderOwner) s.owner = attackerOwner
    if (attackerOwner === 'player') {
      const [dq, dr] = defenderKey.split(',').map(Number)
      revealTile(dq, dr)
    }
  } else {
    state.armies.delete(attackerKey)
  }
  if (attackerOwner === 'player') state.selectedArmy = null
  _checkWin()
}

export function attack(fromQ, fromR, toQ, toR) {
  const fromKey = `${fromQ},${fromR}`
  const toKey   = `${toQ},${toR}`
  if (state.armies.get(fromKey)?.owner !== 'player') return false
  if (!getNeighbors(fromQ, fromR).some(([q, r]) => q === toQ && r === toR)) return false
  // Block attacking pure player territory
  const hasAiClaim = state.aiRoadTiles.has(toKey)
    || state.armies.get(toKey)?.owner === 'ai'
    || state.settlements.get(toKey)?.owner === 'ai'
  if (!hasAiClaim && state.roadTiles.has(toKey)) return false
  _resolve(fromKey, toKey, 'player')
  return true
}

// ── Economy ────────────────────────────────────────────────────────────────────

function _collect(owner) {
  const res = owner === 'player' ? state.resources : state.aiResources
  const rt  = rtOf(owner)
  for (const [key, s] of state.settlements) {
    if (s.owner !== owner || !rt.has(key)) continue
    const mult = s.level === 'city' ? 2 : 1
    for (const [tq, tr] of [[s.q, s.r], ...getNeighbors(s.q, s.r)]) {
      const t = state.tiles.get(`${tq},${tr}`)
      if (t) res[BIOME_YIELD[t.biome]] = Math.min(999, res[BIOME_YIELD[t.biome]] + mult)
    }
  }
}

// ── AI Turn ────────────────────────────────────────────────────────────────────

function _aiTurn() {
  if (!state.aiCapital) return
  const rt = state.aiRoadTiles
  const pc = state.capital

  // 1. Expand roads — bias slightly toward player capital
  if (canAfford('ai', COSTS.road)) {
    const targets = []
    for (const key of rt) {
      const [q, r] = key.split(',').map(Number)
      for (const [nq, nr] of getNeighbors(q, r)) {
        const nk = `${nq},${nr}`
        if (state.tiles.has(nk) && !rt.has(nk)
            && state.armies.get(nk)?.owner !== 'player') {
          targets.push([nq, nr])
        }
      }
    }
    if (targets.length && pc) {
      targets.sort(([aq, ar], [bq, br]) => {
        const da = Math.abs(aq - pc.q) + Math.abs(ar - pc.r)
        const db = Math.abs(bq - pc.q) + Math.abs(br - pc.r)
        return (da - db) + (Math.random() - 0.5) * 4
      })
      _buildRoad('ai', targets[0][0], targets[0][1])
    }
  }

  // 2. Place villages
  if (canAfford('ai', COSTS.village)) {
    const eligible = [...rt].filter(k => !state.settlements.has(k))
    if (eligible.length) {
      const k = eligible[Math.floor(Math.random() * eligible.length)]
      const [q, r] = k.split(',').map(Number)
      if (!state.settlements.has(k) && canAfford('ai', COSTS.village)) {
        spend('ai', COSTS.village)
        state.settlements.set(k, { q, r, level: 'village', owner: 'ai' })
      }
    }
  }

  // 3. Spawn armies near player territory
  if (canAfford('ai', COSTS.army)) {
    const borderTiles = [...rt]
      .map(k => k.split(',').map(Number))
      .filter(([q, r]) =>
        getNeighbors(q, r).some(([nq, nr]) =>
          state.roadTiles.has(`${nq},${nr}`) || state.armies.get(`${nq},${nr}`)?.owner === 'player'
        )
      )
    const pool = borderTiles.length ? borderTiles
                : [...rt].map(k => k.split(',').map(Number))
    if (pool.length) {
      const [q, r] = pool[Math.floor(Math.random() * pool.length)]
      spawnArmy('ai', q, r, 1)
    }
  }

  // 4. Attack player-adjacent tiles
  for (const [key, army] of state.armies) {
    if (army.owner !== 'ai') continue
    const [q, r] = key.split(',').map(Number)
    for (const [nq, nr] of getNeighbors(q, r)) {
      const nk = `${nq},${nr}`
      const isPlayerTile = state.roadTiles.has(nk) || state.armies.get(nk)?.owner === 'player'
      const isAiOnly     = state.aiRoadTiles.has(nk) && !state.roadTiles.has(nk)
      if (isPlayerTile && !isAiOnly) {
        _resolve(key, nk, 'ai')
        break
      }
    }
  }
}

// ── Turn ───────────────────────────────────────────────────────────────────────

export function endTurn() {
  if (state.phase !== 'playing') return
  _collect('player')
  _aiTurn()
  _collect('ai')
  state.turn++
  state.selectedArmy = null
  _checkWin()
}

// ── Win condition ──────────────────────────────────────────────────────────────

function _checkWin() {
  const aiCap = state.aiCapital
  const plCap = state.capital

  if (aiCap && state.settlements.get(`${aiCap.q},${aiCap.r}`)?.owner === 'player') {
    state.phase = 'gameover'; state.winner = 'player'; return
  }
  if (plCap && state.settlements.get(`${plCap.q},${plCap.r}`)?.owner === 'ai') {
    state.phase = 'gameover'; state.winner = 'ai'; return
  }
  const total = state.tiles.size
  if (state.roadTiles.size   >= total * 0.6) { state.phase = 'gameover'; state.winner = 'player' }
  if (state.aiRoadTiles.size >= total * 0.6) { state.phase = 'gameover'; state.winner = 'ai'     }
}

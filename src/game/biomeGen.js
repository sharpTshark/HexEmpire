// Seeded LCG — deterministic RNG, no external deps
function makeLCG(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const BIOMES = [
  { biome: 'forest',    weight: 0.28 },
  { biome: 'fields',    weight: 0.27 },
  { biome: 'quarry',    weight: 0.22 },
  { biome: 'mountains', weight: 0.18 },
  { biome: 'goldmine',  weight: 0.05 },
]

function pickWeighted(roll) {
  let cumulative = 0
  for (const { biome, weight } of BIOMES) {
    cumulative += weight
    if (roll < cumulative) return biome
  }
  return BIOMES[BIOMES.length - 1].biome
}

export function generateBiomes(tiles, seed) {
  const rng = makeLCG(seed)
  for (const tile of tiles.values()) {
    tile.biome = pickWeighted(rng())
  }
}

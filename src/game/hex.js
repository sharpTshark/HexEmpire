export const HEX_SIZE = 36

// Axial → pixel (pointy-top orientation)
export function hexToPixel(q, r) {
  const x = HEX_SIZE * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r)
  const y = HEX_SIZE * (1.5 * r)
  return { x, y }
}

// 6 axial neighbor direction vectors
export const DIRECTIONS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
]

export function getNeighbors(q, r) {
  return DIRECTIONS.map(([dq, dr]) => [q + dq, r + dr])
}

// 6 corner vertices for a pointy-top hex centered at (cx, cy)
export function hexCorners(cx, cy) {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 30)
    return [cx + HEX_SIZE * Math.cos(angle), cy + HEX_SIZE * Math.sin(angle)]
  })
}

// All axial coords within a given hex radius (inclusive), using cube-coord ring sweep
export function hexesInRadius(radius) {
  const results = []
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius)
    const r2 = Math.min(radius, -q + radius)
    for (let r = r1; r <= r2; r++) {
      results.push([q, r])
    }
  }
  return results
}

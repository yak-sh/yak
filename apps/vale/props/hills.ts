// The props of the hills and moors: heather, standing stones, and the
// columns and walls of the old ruins.
import { ball, box, key, type Vox } from '../mesh.ts'
import { noise, stream } from '../rand.ts'
import { type Kind, type Model, OLD, pickOf } from './kit.ts'

let heather = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let bloom = pickOf(r, [0xa0609a, 0xb877b0, 0x8e5a92, 0xc58ab8])
  ball(
    v,
    [0, 0, 0],
    1.6 + r(),
    (x, y, z) => y < 0 ? null : (x + y * 3 + z) % 3 == 0 ? 0x5e7a44 : bloom,
  )
  return { vox: v, size: 0.125 }
}

// A standing stone, spotted with lichen.
let menhir = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 12 + Math.floor(r() * 8)
  let greys = [0x9a978e, 0x8a877e, 0xa8a59b]
  for (let y = 0; y <= tall; y++) {
    let w = y > tall - 3 ? 1 : 2
    for (let x = -w; x < w; x++) {
      for (let z = -1; z <= 0; z++) {
        v.set(
          key(x, y, z),
          noise(x * 0.8 + 3, y * 0.5, seed % 97) > 0.8
            ? 0x93a868
            : greys[(x + y + z) & 1 ? 0 : y % 3],
        )
      }
    }
  }
  return { vox: v, size: 0.25 }
}

// A column, most of them broken off.
let pillar = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let whole = r() < 0.3
  let tall = whole ? 22 : 6 + Math.floor(r() * 12)
  box(v, [-2, 0, -2], [2, 1, 2], OLD[2])
  for (let y = 2; y <= tall; y++) {
    ball(
      v,
      [0, y, 0],
      1.6,
      (x, yy, z) =>
        yy != y
          ? null
          : !whole && y == tall && (x + z) & 1
          ? null
          : OLD[(x + z + y) & 1],
    )
  }
  if (whole) box(v, [-2, tall + 1, -2], [2, tall + 2, 2], OLD[0])
  box(v, [-2, 2, 1], [-1, 3, 2], 0x6f9a48)
  return { vox: v, size: 0.25 }
}

// A stretch of broken wall, a window left in it.
let ruin = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let high = 8 + Math.floor(r() * 6)
  for (let x = -6; x <= 5; x++) {
    let top = Math.round(high - Math.abs(x + 0.5) * 0.6 + noise(x, 0, seed) * 4)
    for (let y = 0; y <= top; y++) {
      if (y >= 5 && y <= 7 && x >= -1 && x <= 0) continue
      for (let z = -1; z <= 0; z++) {
        v.set(key(x, y, z), OLD[((x >> 1) + y + z) & 1 ? 0 : (y % 3) ? 1 : 2])
      }
    }
    if (noise(x, 3, seed) > 0.6) v.set(key(x, top + 1, 0), 0x6f9a48)
  }
  return { vox: v, size: 0.25 }
}

export let HILLS: Record<string, Kind> = {
  heather: { make: heather, shapes: 5, small: true },
  menhir: { make: menhir, shapes: 5, solid: true, foot: 1 },
  pillar: { make: pillar, shapes: 6, solid: true, foot: 1.2 },
  ruin: { make: ruin, shapes: 4, girth: 0.4, row: 1.2, foot: 2.8 },
}

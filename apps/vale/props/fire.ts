// The props of the fire country: cinder and basalt; and each level's own:
// Emberfall's forges, the anvil in their midst, trees burnt black and the
// lava falling down its volcano; Cinderreach's vents; Ashkeep's tower, walls,
// gate and banners; the Maw's obsidian and the thorn that grows out of it.
import { ball, box, key, type Vox } from '../mesh.ts'
import { noise, rand, stream } from '../rand.ts'
import { boulders, type Kind, type Model, pickOf } from './kit.ts'

let EMBER = [0xff7a2a, 0xffa040, 0xe0501a]

// Cinder: black rock the fire spat out.
let cinder = boulders([0x4e4b48, 0x5c5854, 0x423f3c], null)

// Columns of dark basalt, standing close.
let basalt = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let darks = [0x3e3c3a, 0x484542, 0x34322f]
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      if (r() < 0.35 && (x || z)) continue
      let tall = 1 + Math.floor(r() * 5) + (x || z ? 0 : 2)
      box(v, [x, 0, z], [x, tall, z], pickOf(r, darks))
      v.set(key(x, tall, z), 0x5a5652)
    }
  }
  return { vox: v, size: 0.5 }
}

let SOOT = [0x4a4440, 0x5a524c, 0x3e3834]

// A forge of Emberfall: a smithy of sooty stone, its furnace mouth glowing
// in the south wall, its chimney tall and black.
let forgehouse = (seed: number): Model => {
  let v: Vox = new Map()
  let w = 24, d = 18, wall = 10 + (seed % 2) * 2
  let x0 = -w / 2, x1 = w / 2 - 1, z0 = -d / 2, z1 = d / 2 - 1
  for (let y = 0; y <= wall; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        if (y < wall && x > x0 && x < x1 && z > z0 && z < z1) continue
        v.set(key(x, y, z), SOOT[(x + y * 2 + z) % 3])
      }
    }
  }
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    for (let z = z0 - 1; z <= z1 + 1; z++) {
      v.set(key(x, wall + 1, z), 0x6a4a3a)
    }
  }
  box(v, [-7, 0, z1], [-3, 4, z1], EMBER[0])
  box(v, [-6, 1, z1], [-4, 3, z1], EMBER[1])
  box(v, [2, 0, z1], [5, 7, z1], 0x2a2220)
  box(v, [-8, wall + 1, -6], [-4, wall + 12, -2], SOOT[2])
  box(v, [-7, wall + 12, -5], [-5, wall + 12, -3], 0x1a1614)
  return { vox: v, size: 0.25 }
}

// The anvil the forges gather round, on its block.
let anvil = (): Model => {
  let v: Vox = new Map()
  box(v, [-2, 0, -2], [2, 4, 2], 0x5a3e2a)
  box(v, [-3, 5, -1], [3, 5, 1], 0x3a3a40)
  box(v, [-2, 6, -1], [2, 7, 1], 0x4a4a52)
  box(v, [3, 7, 0], [5, 7, 0], 0x4a4a52)
  return { vox: v, size: 0.25 }
}

// A tree the fire went through: black, its cracks still glowing.
let chartree = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 10 + Math.floor(r() * 7)
  for (let y = 0; y <= tall; y++) {
    for (let [x, z] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      let crack = rand(x + y, z, seed) < 0.06
      v.set(key(x, y, z), crack ? EMBER[0] : y & 1 ? 0x2a2624 : 0x221e1c)
    }
  }
  for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
    let y = 4 + Math.floor(r() * (tall - 4))
    let [dx, dz] = pickOf(r, [[1, 0], [-1, 0], [0, 1], [0, -1]])
    for (let j = 1; j <= 2 + Math.floor(r() * 3); j++) {
      v.set(
        key(dx * j + (dx > 0 ? 1 : 0), y + j, dz * j + (dz > 0 ? 1 : 0)),
        0x2a2624,
      )
    }
  }
  return { vox: v, size: 0.25 }
}

// Lava breaking out of a vent in the south flank of Emberfall's volcano and
// running down it, crusted black at its edges.
let lavafall = (): Model => {
  let v: Vox = new Map()
  ball(
    v,
    [0, 0, 0],
    5,
    (x, y, z) =>
      y < -2 || Math.hypot(x, z) < 2 && y > 1 ? null : SOOT[(x + y + z) & 1],
  )
  for (let t = 0; t <= 44; t++) {
    let wide = 2 + Math.round(noise(t * 0.3, 2, 7) * 2) + Math.floor(t / 15)
    let y = -Math.round(t * 0.65)
    for (let x = -wide - 1; x <= wide + 1; x++) {
      let edge = Math.abs(x) > wide
      for (let dy = 0; dy <= 5; dy++) {
        let c = edge || dy < 5
          ? 0x2a2220
          : EMBER[noise(x * 0.6, t * 0.4, 3) > 0.55 ? 1 : 0]
        v.set(key(x, y + dy - 3, t + 2), c)
      }
    }
  }
  return { vox: v, size: 0.25 }
}

// A vent in Cinderreach: a mound crusted yellow with brimstone round a dark
// throat.
let fumarole = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let rad = 3 + r() * 1.5
  ball(v, [0, 0, 0], rad, (x, y, z) => {
    if (y < 0 || Math.hypot(x, z) < 1.2) return null
    return y >= rad - 2 && noise(x, z, seed) > 0.35
      ? pickOf(r, [0xd8c040, 0xc8a830, 0xe8d860])
      : SOOT[(x + y + z) & 1]
  })
  box(v, [0, 0, 0], [0, 1, 0], 0x1a1614)
  return { vox: v, size: 0.25 }
}

let KEEP = [0x5a5a5e, 0x6a6a6e, 0x4a4a4e]

// The tower of Ashkeep: square, dark, slit for arrows, its top broken, the
// soot of the fire up its walls.
let keeptower = (): Model => {
  let v: Vox = new Map()
  for (let y = 0; y <= 52; y++) {
    for (let x = -8; x <= 7; x++) {
      for (let z = -8; z <= 7; z++) {
        let wall = x == -8 || x == 7 || z == -8 || z == 7
        if (!wall) continue
        let broke = y > 44 && noise(x * 0.5, z * 0.5, 2) * 10 < y - 44
        if (broke) continue
        let slit = y % 10 == 5 && (x == 0 || z == 0)
        let soot = y < 14 && noise(x, y * 0.3 + z, 4) > 0.5
        v.set(
          key(x, y, z),
          slit ? 0x1a1a1c : soot ? 0x2e2e30 : KEEP[(y + x) % 3],
        )
      }
    }
  }
  box(v, [-2, 0, 7], [1, 8, 7], 0x1a1614)
  return { vox: v, size: 0.25 }
}

// A stretch of Ashkeep's curtain wall, battlemented, broken here and there.
let curtain = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let broke = r() < 0.4 ? Math.floor(r() * 10) - 5 : 99
  for (let x = -6; x <= 5; x++) {
    let gap = Math.abs(x - broke) < 2
    let top = gap ? 5 + Math.floor(noise(x, 1, seed) * 4) : 18
    for (let y = 0; y <= top; y++) {
      for (let z = -2; z <= 1; z++) {
        let soot = y < 8 && noise(x, y * 0.4, seed) > 0.55
        v.set(key(x, y, z), soot ? 0x2e2e30 : KEEP[(x + y + z) % 3])
      }
    }
    if (!gap && (x & 1) == 0) box(v, [x, 19, -2], [x, 20, 1], KEEP[1])
  }
  return { vox: v, size: 0.25 }
}

// The ruined gate south-east of the keep, where the road ran to the Maw: two
// towers, the arch gone, the portcullis fallen across the way.
let ashgate = (): Model => {
  let v: Vox = new Map()
  for (let side of [-1, 1]) {
    for (let y = 0; y <= 22 - (side > 0 ? 6 : 0); y++) {
      for (let x = side * 10 - 4; x <= side * 10 + 4; x++) {
        for (let z = -4; z <= 4; z++) {
          if (Math.abs(x - side * 10) < 4 && Math.abs(z) < 4) continue
          v.set(key(x, y, z), KEEP[(x + y + z) % 3])
        }
      }
    }
  }
  for (let x = -5; x <= 5; x++) {
    for (let z = -1; z <= 8; z++) {
      if (x % 2 == 0 || z % 3 == 0) v.set(key(x, 0, z), 0x3a3a40)
    }
  }
  return { vox: v, size: 0.25 }
}

// A banner of Ashkeep on its pole, red and black, burnt ragged.
let banner = (seed: number): Model => {
  let v: Vox = new Map()
  box(v, [0, 0, 0], [0, 22, 0], 0x3a2a20)
  for (let y = 10; y <= 21; y++) {
    for (let x = 1; x <= 6; x++) {
      if (y < 10 + noise(x, seed, 5) * 4) continue
      v.set(key(x, y, 0), (y >> 2) & 1 ? 0x8a1a1a : 0x1a1414)
    }
  }
  return { vox: v, size: 0.25 }
}

// Obsidian: black glass the fire poured out, sharp, a violet sheen at its
// edges.
let obsidian = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  for (let i = 0; i < 3 + Math.floor(r() * 4); i++) {
    let x = Math.floor(r() * 7) - 3, z = Math.floor(r() * 7) - 3
    let tall = 2 + Math.floor(r() * 8)
    for (let y = 0; y <= tall; y++) {
      let w = y < tall / 2 ? 1 : 0
      box(v, [x, y, z], [x + w, y, z + w], y == tall ? 0x6a4a8a : 0x16121c)
    }
  }
  return { vox: v, size: 0.25 }
}

// The thorn in the Maw: the briar's root, black, twisting up out of the lava
// as tall as a tower, thorns all down it, their tips burning.
let thornspire = (): Model => {
  let v: Vox = new Map()
  for (let y = 0; y <= 34; y++) {
    let t = y / 34, rad = 3.5 * (1 - t) + 0.6
    let cx = Math.round(Math.sin(y * 0.25) * 3 * t),
      cz = Math.round(Math.cos(y * 0.2) * 2 * t)
    ball(
      v,
      [cx, y, cz],
      rad,
      (_x, yy) => yy != y ? null : y & 1 ? 0x1e1618 : 0x2a1e20,
    )
    if (y % 3 == 0 && y < 32) {
      let a = y * 2.4, dx = Math.cos(a), dz = Math.sin(a)
      for (let j = 1; j <= 3; j++) {
        let at = key(
          cx + Math.round(dx * (rad + j)),
          y + j,
          cz + Math.round(dz * (rad + j)),
        )
        v.set(at, j == 3 ? EMBER[0] : 0x2a1e20)
      }
    }
  }
  return { vox: v, size: 0.5 }
}

export let FIRE: Record<string, Kind> = {
  cinder: { make: cinder, shapes: 5, solid: true },
  basalt: { make: basalt, shapes: 5, solid: true },
  forgehouse: {
    make: forgehouse,
    shapes: 2,
    foot: 4.5,
    span: [6, 4.5],
    glow: { at: [-1.25, 0.6, 2.4], size: 3.5, color: 0xff7a2a },
  },
  anvil: { make: anvil, girth: 1, foot: 1.2 },
  chartree: { make: chartree, shapes: 5, girth: 0.5 },
  lavafall: {
    make: lavafall,
    foot: 3,
    glow: { at: [0, -3, 6], size: 8, color: 0xff5a1a },
  },
  fumarole: { make: fumarole, shapes: 4, solid: true },
  keeptower: { make: keeptower, foot: 3, span: [4, 4] },
  curtain: { make: curtain, shapes: 4, row: 1.5, girth: 1 },
  ashgate: { make: ashgate, foot: 4 },
  banner: { make: banner, shapes: 3, girth: 0.3 },
  obsidian: { make: obsidian, shapes: 5 },
  thornspire: {
    make: thornspire,
    girth: 3,
    foot: 5,
    glow: { at: [0, 6, 0], size: 10, color: 0xff3a1a },
  },
}

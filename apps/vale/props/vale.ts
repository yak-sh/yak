// The props of the green country round Mossvale: its trees, its boulders,
// and the flowers, grass and mushrooms underfoot.
import { ball, box, key, type Vox } from '../mesh.ts'
import { rand, stream } from '../rand.ts'
import { boulders, canopy, type Kind, type Model, pickOf } from './kit.ts'

let oak = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 4 + Math.floor(r() * 3)
  box(v, [0, 0, 0], [0, tall, 0], 0x7a5236)
  box(v, [0, 0, 1], [0, 1, 1], 0x6e4a31)
  let greens = pickOf(r, [
    [0x4d9340, 0x62ad4c, 0x7cc45a],
    [0x4a8a3c, 0x5c9f45, 0x74b851],
    [0x5a9a3a, 0x77b646, 0x98cc59],
  ])
  canopy(v, [0, tall + 2, 0], 3.2 + r(), greens, seed % 97)
  canopy(v, [2, tall + 1, 1], 2.2, greens, seed % 89)
  canopy(v, [-2, tall + 1, -1], 2.2, greens, seed % 83)
  return { vox: v, size: 0.5 }
}

let pine = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 9 + Math.floor(r() * 4)
  box(v, [0, 0, 0], [0, 2, 0], 0x6b4a33)
  let dark = pickOf(r, [0x3d7447, 0x356b43, 0x44804d])
  for (let y = 2; y < tall; y++) {
    let t = (y - 2) / (tall - 2)
    let rad = (1 - t) * 3.2 + (y % 2) * 0.5
    ball(v, [0, y, 0], rad, (x, yy, z) => {
      if (yy != y) return null
      let edge = Math.hypot(x, z) > rad - 1
      return edge && y > tall - 3 && seed % 3 == 0
        ? 0xf1f4f6
        : edge
        ? dark
        : 0x2f5f3c
    })
  }
  v.set(key(0, tall, 0), dark)
  return { vox: v, size: 0.5 }
}

let birch = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 6 + Math.floor(r() * 3)
  for (let y = 0; y <= tall; y++) {
    v.set(key(0, y, 0), rand(y, seed) < 0.25 ? 0x4b4640 : 0xebe6da)
  }
  canopy(v, [0, tall + 1, 0], 2.6, [0x8fbf4f, 0xa6d15e, 0xc4e27a], seed % 71)
  return { vox: v, size: 0.5 }
}

let rock = boulders([0x8f8e86, 0xa3a198, 0x7f7e77], 0x6f9a48)

let BLOOMS = [0xf6f1e4, 0xf5d451, 0xf08aa8, 0x8fb4f2, 0xe8745a, 0xc59af0]

let flower = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let c = pickOf(r, BLOOMS)
  let n = 1 + Math.floor(r() * 3)
  for (let i = 0; i < n; i++) {
    let x = Math.floor(r() * 4) - 2, z = Math.floor(r() * 4) - 2
    let tall = 2 + Math.floor(r() * 3)
    box(v, [x, 0, z], [x, tall, z], 0x4f8f3c)
    for (let [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      v.set(key(x + dx, tall + 1, z + dz), c)
    }
    v.set(key(x, tall + 1, z), 0xf7d64a)
  }
  return { vox: v, size: 0.125 }
}

let tuft = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let blades = 3 + Math.floor(r() * 3)
  for (let i = 0; i < blades; i++) {
    let x = Math.floor(r() * 4) - 2, z = Math.floor(r() * 4) - 2
    let tall = 1 + Math.floor(r() * 3)
    box(v, [x, 0, z], [x, tall, z], pickOf(r, [0x6fae4d, 0x7fbe57, 0x5f9e45]))
  }
  return { vox: v, size: 0.125 }
}

let mushroom = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let cap = pickOf(r, [0xd9493a, 0xc9803f, 0xe7c26a])
  box(v, [0, 0, 0], [0, 2, 0], 0xf1eadb)
  box(v, [-1, 3, -1], [1, 3, 1], cap)
  v.set(key(0, 4, 0), cap)
  v.set(key(1, 3, 1), 0xfbf6ea)
  return { vox: v, size: 0.125 }
}

export let VALE: Record<string, Kind> = {
  oak: { make: oak, shapes: 6, girth: 0.45 },
  pine: { make: pine, shapes: 5, girth: 0.45 },
  birch: { make: birch, shapes: 4, girth: 0.45 },
  rock: { make: rock, shapes: 6, solid: true },
  flower: { make: flower, shapes: 8, small: true },
  tuft: { make: tuft, shapes: 6, small: true },
  mushroom: { make: mushroom, shapes: 3, small: true },
}

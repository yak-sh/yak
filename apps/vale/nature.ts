// Which wild props are resources. Terrain grows these from its feature data;
// gathering gives them the same identity and lifecycle as placed nodes.
// The value is the lode whose material and trade this prop gives.
import type { Vec } from './mesh.ts'
import { CHUNK, chunkOf, type Prop, standAt, type Vale } from './terrain.ts'
import { off, step } from './stand.ts'

export type Natural = { prop: Prop; at: Vec }

/** The point a planted resource occupies, shared by the page and a tick. */
export let naturalAt = (v: Vale, prop: Prop): Natural => {
  let [dx, dy, dz] = off(step(v, prop))
  return {
    prop,
    at: [prop.x + dx, standAt(v, prop) + dy, prop.z + dz],
  }
}

/** Planted resources around a point, whether a chunk is drawn or not. */
export let naturalNear = (
  v: Vale,
  x: number,
  z: number,
  r: number,
): Natural[] => {
  let out: Natural[] = []
  for (let ci = chunkOf(x - r); ci <= chunkOf(x + r); ci++) {
    for (let ck = chunkOf(z - r); ck <= chunkOf(z + r); ck++) {
      for (let p of v.plant(ci, ck)) {
        if (p.natural && Math.hypot(p.x - x, p.z - z) < r + CHUNK) {
          out.push(naturalAt(v, p))
        }
      }
    }
  }
  return out
}

export let NATURE: Record<string, string> = {
  oak: 'oak',
  birch: 'oak',
  elder: 'oak',
  treefern: 'oak',
  autumnoak: 'oak',
  swamptree: 'oak',
  yew: 'oak',
  deadtree: 'oak',
  pine: 'pine',
  greypine: 'pine',
  darkpine: 'pine',
  shorepine: 'pine',
  windtree: 'pine',
  driftlog: 'driftwood',
  log: 'driftwood',
  palm: 'palm',
  datepalm: 'palm',
  cottonwood: 'palm',
  toadstool: 'toadstool',
  glowcap: 'toadstool',
  violetcap: 'toadstool',
  palecap: 'toadstool',
  spruce: 'spruce',
  bigspruce: 'spruce',
  rimespruce: 'rimepine',
  stuntpine: 'rimepine',
  chartree: 'charpine',
  rock: 'copper',
  chalk: 'copper',
  sandstone: 'sunstone',
  snowrock: 'iceore',
  serac: 'iceore',
  cinder: 'emberstone',
  basalt: 'iron',
  columns: 'iron',
  block: 'copper',
  cairn: 'copper',
  menhir: 'copper',
  obsidian: 'obsidian',
  crystal: 'gleam',
  amethyst: 'gleam',
  clearstone: 'gleam',
  glassrock: 'gleam',
  hoodoo: 'sunstone',
  shard: 'gleam',
}

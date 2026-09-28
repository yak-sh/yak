// Worker-built geometry for natural resources, rebuilt one chunk at a time
// when gathering changes their visible state. It uses the chunk's voxel edge
// so a spent or rare resource has the same detail as its first mesh.
import { cuboids } from './boxes.ts'
import { LODES, naturalEid, nodeRarity } from './gather.ts'
import { type Out, out, pack, type Packed, place } from './mesh.ts'
import { type Natural, NATURE } from './nature.ts'
import { model } from './props.ts'
import { GRADES, type Rarity } from './rarity.ts'
import type { Stood } from './stand.ts'
import { CHUNK } from './terrain.ts'

export type NatureState = Natural & { spent: boolean; rarity: Rarity }
export type ChunkProps = {
  ci: number
  ck: number
  voxel: number
  natural: Natural[]
  nature: Packed | null
  stood: Stood[]
}

export let baseline = (n: Natural): NatureState => ({
  ...n,
  spent: false,
  rarity: nodeRarity(naturalEid(n.prop), 0),
})

/** One mesh per chunk, including the spent shape and a rare find's color. */
export let natureMesh = (
  ci: number,
  ck: number,
  entries: NatureState[],
  voxel: number,
): Packed | null => {
  if (!entries.length) return null
  let o: Out = out()
  for (let { prop: p, at, spent, rarity } of entries) {
    let [x, y, z] = [at[0] - ci * CHUNK, at[1], at[2] - ck * CHUNK]
    if (spent) {
      let wood = LODES[NATURE[p.kind]].trade == 'wood'
      let color = wood ? 0x765737 : 0x797b75
      cuboids(
        o,
        wood
          ? [[[x - 0.3, y, z - 0.3], [0.6, 0.35, 0.6], color]]
          : [[[x - 0.4, y, z - 0.3], [0.35, 0.25, 0.4], color], [
            [x + 0.15, y, z + 0.1],
            [0.3, 0.2, 0.25],
            color,
          ]],
      )
      continue
    }
    place(o, model(p.kind, p.seed, p.turn, true, voxel), [x, y, z])
    if (rarity == 'common') continue
    let color = GRADES[rarity].light
    cuboids(o, [
      [[x - 0.48, y + 0.04, z - 0.48], [0.12, 0.28, 0.12], color],
      [[x + 0.36, y + 0.04, z - 0.48], [0.12, 0.28, 0.12], color],
      [[x - 0.48, y + 0.04, z + 0.36], [0.12, 0.28, 0.12], color],
      [[x + 0.36, y + 0.04, z + 0.36], [0.12, 0.28, 0.12], color],
    ])
  }
  return pack(o)
}

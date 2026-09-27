// Grain enters from the village path, is ground on the stone inside, and
// leaves as flour in sacks. The east-side wheel stands in the millrace.
import type { Plan } from './kit.ts'
import { barrel, lamp, millstone, sacks, shelf } from './pieces.ts'

export let MILL: Plan = {
  name: 'mill',
  size: [8, 7],
  works: 'mill',
  storeys: [{
    height: 3.5,
    walls: 'stone',
    doors: [{ side: 'south', at: -1.5, wide: 1.5 }],
    windows: [
      { side: 'south', at: 2 },
      { side: 'north', at: -2 },
      { side: 'west', at: 1 },
    ],
    furnish: [
      { piece: millstone, at: [-1.5, -0.5] },
      { piece: sacks, on: 'north', at: 1.5 },
      { piece: shelf, on: 'west', at: -2 },
      { piece: barrel, at: [1.5, 1] },
      { piece: lamp, on: 'south', at: -3 },
    ],
  }],
  more: (k) => {
    // Two timber rims, spokes and buckets form the wheel; an axle joins it
    // to the mill's east wall. Its bottom dips into the water beside it.
    let y = k.floors[0] + 6
    for (let d of [-2, -4]) {
      for (let z = -6; z <= 6; z++) {
        for (let h = -6; h <= 6; h++) {
          let r = Math.hypot(z, h)
          if (r >= 5 && r < 6.4) {
            let [x, zz] = k.cell('east', z, d)
            k.put(x, y + h, zz, k.dress.timber, 'the waterwheel')
          }
        }
      }
    }
    for (let z = -5; z <= 5; z++) {
      for (let h = -5; h <= 5; h++) {
        if (
          Math.hypot(z, h) < 6 &&
          (z == 0 || h == 0 || Math.abs(z) == Math.abs(h))
        ) {
          let [x, zz] = k.cell('east', z, -3)
          k.put(x, y + h, zz, k.dress.timber, 'the waterwheel')
        }
      }
    }
    for (let d = -1; d >= -5; d--) {
      let [x, z] = k.cell('east', 0, d)
      k.put(x, y, z, k.dress.timber, 'the axle')
    }
  },
}

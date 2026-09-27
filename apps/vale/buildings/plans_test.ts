// Each home and farm building raises in every land's materials and every
// roof/grain seed. Raising catches any overlap with a wall, door, stair,
// piece or the room needed to use one.
import { DRESSES } from './dress.ts'
import { BARN, STABLE } from './farm.ts'
import { COTTAGE, FARMHOUSE, HOUSE } from './homes.ts'
import { raise } from './kit.ts'

Deno.test('homes and farm buildings raise in every dress and seed', () => {
  for (let plan of [COTTAGE, HOUSE, FARMHOUSE, STABLE, BARN]) {
    for (let [name, dress] of Object.entries(DRESSES)) {
      for (let seed = 0; seed < 4; seed++) {
        let label = `${plan.name}.${name}:${seed}`
        try {
          raise(plan, dress, seed)
        } catch (error) {
          throw new Error(`${label}: ${error}`)
        }
      }
    }
  }
})

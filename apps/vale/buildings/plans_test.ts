// Each home and farm building raises in every land's materials and every
// roof/grain seed. Raising catches any overlap with a wall, door, stair,
// piece or the room needed to use one.
import { test } from '@yaks/testing'
import { DRESSES } from './dress.ts'
import { PLANS } from '../buildings.ts'
import { seedBuildings } from '../buildings_fixture.ts'
import { raise } from './kit.ts'

seedBuildings()

test('homes and farm buildings raise in every dress and seed', () => {
  for (
    let plan of ['cottage', 'house', 'farmhouse', 'stable', 'barn'].map(
      (kind) => PLANS[kind],
    )
  ) {
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

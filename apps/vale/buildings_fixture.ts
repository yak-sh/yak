// Seed the building index for tests that run without the app's store.
import plans from './seed/buildings/plans.json' with { type: 'json' }
import type { Bundle } from './net.ts'
import { installBuildingDesigns } from './terrain.ts'

export let rows = plans as Bundle[]
export let seedBuildings = () => {
  installBuildingDesigns(rows)
}

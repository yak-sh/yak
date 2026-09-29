// Seed the building index for tests that run without the app's store.
import rows from './seed/buildings/plans.json' with { type: 'json' }
import type { Bundle } from './net.ts'
import { installBuildingDesigns } from './terrain.ts'

export let seedBuildings = () => {
  installBuildingDesigns(rows as Bundle[])
}

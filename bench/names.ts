// Benchmark names and normalization, without fixture setup or runtime effects.
import { benchmarkNames as storageNames } from '../packages/sqlite/fixtures/fleet.ts'
export const APPLY_SIZES = [200, 1000] as const
export const APPLY_MODES = ['file', 'ram'] as const
export const APPLY_WORK = ['edit', 'create'] as const
export const APPLY_SHAPES = ['alone', 'batch'] as const
export const applyBenchmarkNames = () =>
  APPLY_MODES.flatMap((mode) =>
    APPLY_WORK.flatMap((work) =>
      APPLY_SIZES.flatMap((n) =>
        APPLY_SHAPES.map((shape) => `apply/${mode}/${work}-${shape}-${n}`)
      )
    )
  )
export const RELAY_ENTITIES = [1, 10, 100] as const
export const RELAY_TICKS = 10
export const relayBenchmarkName = (n: number) => `relay/store/entities-${n}`
export const relayBenchmarkNames = () => RELAY_ENTITIES.map(relayBenchmarkName)
export const benchmarkNames =
  () => [...storageNames(), ...applyBenchmarkNames(), ...relayBenchmarkNames()]
export const bundlesPerOp = (name: string) =>
  name.startsWith('apply/')
    ? Number(name.split('-').at(-1))
    : name.startsWith('relay/')
    ? RELAY_TICKS * Number(name.split('-').at(-1))
    : 1

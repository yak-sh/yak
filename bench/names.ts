// Benchmark names and normalization, without fixture setup or runtime effects.
import { benchmarkNames as storageNames } from '../packages/sqlite/fixtures/fleet.ts'
export const RECORDING_BATCHES = 5
export const APPLY_SIZES = [200, 1000] as const
export const APPLY_MODES = ['file', 'ram'] as const
export const APPLY_WORK = ['edit', 'create'] as const
export const APPLY_SHAPES = ['alone', 'batch'] as const
export const applyBenchmarkNames = (recording = false) =>
  APPLY_MODES.flatMap((mode) =>
    APPLY_WORK.flatMap((work) =>
      APPLY_SIZES.flatMap((n) =>
        APPLY_SHAPES.flatMap((shape) => {
          let name = `apply/${mode}/${work}-${shape}-${n}`
          return recording ? [name, `${name}/subscribed`] : [name]
        })
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
    ? Number(name.split('/')[2].split('-').at(-1))
    : name.startsWith('relay/')
    ? RELAY_TICKS * Number(name.split('-').at(-1))
    : 1

// Benchmark names and normalization, without fixture setup or runtime effects.
export const RECORDING_BATCHES = 5
export const APPLY_CASES = [
  { mode: 'file', work: 'edit', n: 1000, shape: 'alone' },
  { mode: 'file', work: 'create', n: 200, shape: 'alone' },
  { mode: 'file', work: 'create', n: 1000, shape: 'alone' },
] as const
// Each callback already applies 200 or 1,000 bundles. Paired collection rounds
// repeat those CPU observations; these counts only warm and time one callback.
export const APPLY_SAMPLING = { n: 1, warmup: 1 } as const
export const applyBenchmarkNames = (recording = false) =>
  APPLY_CASES.flatMap(({ mode, work, n, shape }) => {
    let name = `apply/${mode}/${work}-${shape}-${n}`
    return recording ? [name, `${name}/subscribed`] : [name]
  })
export const RELAY_ENTITIES = [1, 10, 100] as const
export const bundlesPerOp = (name: string) =>
  name.startsWith('apply/') ? Number(name.split('/')[2].split('-').at(-1)) : 1

// Drive declared files through the executor. Loading and dependency observation
// belong to the caller; the executor owns assertions, timing and failures.
import { file, type Outcome } from './run.ts'
import type { Test } from './suite.ts'

/** Load each file, then run its tests before loading the next. */
export let drive = async (
  paths: string[],
  load: (path: string) => Promise<Test[]>,
  { timeout = 50_000, verbose = false } = {},
) => {
  let outcomes: Outcome[] = []
  let loading = 0
  let loads: Record<string, number> = {}
  for (let path of paths) {
    console.log(`loading ${path}`)
    let begun = performance.now()
    let tests = await load(path)
    let loaded = performance.now() - begun
    loading += loaded
    loads[path] = loaded
    outcomes.push(...await file(path, tests, timeout, loaded, verbose))
  }
  return { outcomes, loading, loads }
}

// Drive declared files through the executor. Loading and dependency observation
// belong to the caller; the executor owns assertions, timing and failures.
import { apart, end, file, globals, type Outcome } from './run.ts'
import type { Test } from './suite.ts'

/** Load each file, then run its tests and end it (./run.ts `end`) before
 * loading the next, each file with its own global error events (./run.ts
 * `apart`), and the globals its tests changed put back once it ends (./run.ts
 * `globals`). What loading installed stays: the modules it imported are the
 * next file's too, and a global one installs as it is first imported (an
 * `HTMLRewriter`, say) is installed only then. Says what loading took in all and each file's load, and what
 * each file took whole.
 * Once `full` says the runtime holds all it should, after a file, the files
 * not yet loaded are left in `rest` for another runtime. */
export let drive = async (
  paths: string[],
  load: (path: string) => Promise<Test[]>,
  {
    timeout = 50_000,
    verbose = false,
    full = (): boolean | Promise<boolean> => false,
  } = {},
) => {
  let outcomes: Outcome[] = []
  let loading = 0
  let loads: Record<string, number> = {}
  let took: Record<string, number> = {}
  for (let [i, path] of paths.entries()) {
    if (i && await full()) {
      return { outcomes, loading, loads, took, rest: paths.slice(i) }
    }
    console.log(`loading ${path}`)
    apart()
    let begun = performance.now()
    let tests = await load(path)
    let restore = globals()
    let loaded = performance.now() - begun
    loading += loaded
    loads[path] = loaded
    outcomes.push(...await file(path, tests, timeout, loaded, verbose))
    outcomes.push(...await end(path, timeout, verbose))
    restore()
    took[path] = Math.round(performance.now() - begun)
  }
  return { outcomes, loading, loads, took, rest: [] as string[] }
}

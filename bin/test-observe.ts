import { registerHooks } from 'node:module'
import { observe, path } from '@yaks/testing/reads'

// Preloaded into a source check a run keeps by what it read
// (./test-checks.ts `kept`): every checkout file it reads, and every module
// it loads, static or by `import()`, written as it exits to the file named by
// `OBSERVED`. A module it could import but never does is not among them, nor
// what an install laid out (`node_modules`), which its lockfile holds.

/** Set in a check's environment: where its reads are written. */
export let OBSERVED = 'TASKS_TEST_OBSERVED'

let out = Deno.env.get(OBSERVED)
if (out) {
  let root = Deno.cwd()
  let seen = observe(root)
  seen.mark('')
  let loaded = new Set<string>()
  registerHooks({
    resolve(specifier, context, next) {
      let found = next(specifier, context)
      let at = found.url.startsWith('file:') && path(found.url, root)
      if (at) loaded.add(at)
      return found
    },
  })
  globalThis.addEventListener('unload', () => {
    let read = new Set([...seen.reads().get('') ?? [], ...loaded])
    let own = [...read].filter((p) => !/(^|\/)node_modules\//.test(p))
    Deno.writeTextFileSync(out, JSON.stringify(own.sort()))
  })
}

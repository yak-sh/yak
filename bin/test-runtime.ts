// Preloaded into each platform's runtime (bin/test.ts `runtime`): the runtime
// runs on a module cache of its own, and what it starts runs on the run's.

/** Set in a runtime's environment: the run's module cache. */
export let SHARED = 'TASKS_TEST_DENO_DIR'

let shared = Deno.env.get(SHARED)
if (shared) Deno.env.set('DENO_DIR', shared)

// The fetch API's classes, loaded before any test runs. Deno loads a global's
// script the first time it is read, and loading Response took 0.6 to 2 ms of
// whichever test made the first one. A URL's first search params are read
// here too: the test that read them first paid 0.3 ms.
void [Headers, Request, Response]
new URL('https://x.test/?a').searchParams.has('a')

// The tests' one sanctioned wait, and the module cache a child should run on.
// A test never sleeps a fixed span: it yields with `tick` and waits on a fact
// with `until`, both deterministic, so nothing pads for a settle that a loaded
// box would stretch past the pad.
//
// Tests are divided by the platform they run on, never by speed: bin/test.ts
// runs the deno pass and then the workerd pass, starting each environment once
// (M-39441). A slow test is made fast at its seam, not moved somewhere else.

// One macrotask yield — lets queued timers/microtasks flush without a span.
export let tick = () => new Promise<void>((go) => setTimeout(go, 0))

// Wait for a fact to become true, polling instead of guessing a duration. The
// budget only exists to fail instead of hanging; `label` (a string or a thunk,
// resolved late so it can name live state) says what stalled on a timeout.
export let until = async <T>(
  fact: () => T | Promise<T>,
  { timeout = 2000, poll = 5, label = 'it' }: {
    timeout?: number
    poll?: number
    label?: string | (() => string)
  } = {},
): Promise<NonNullable<T>> => {
  let deadline = Date.now() + timeout
  while (true) {
    let v = await fact()
    if (v) return v
    // A delayed poll may resume after the fact settled and the deadline.
    if (Date.now() >= deadline) break
    await new Promise((go) => setTimeout(go, poll))
  }
  throw new Error(
    `until: timed out after ${timeout}ms waiting for ${
      typeof label == 'function' ? label() : label
    }`,
  )
}

// The module cache this process runs on: DENO_DIR where the environment pins
// it, and Deno's own default for the platform otherwise.
let denoCache = (() => {
  let configured = Deno.env.get('DENO_DIR')
  if (configured) return configured
  let home = Deno.env.get('HOME')
  if (Deno.build.os == 'darwin') return `${home}/Library/Caches/deno`
  if (Deno.build.os == 'windows') return `${Deno.env.get('LOCALAPPDATA')}\\deno`
  return `${Deno.env.get('XDG_CACHE_HOME') ?? `${home}/.cache`}/deno`
})()

// That cache, with the runner's own TEST_DENO_DIR ahead of it so a suite can
// be pointed at a scratch cache. A test that redirects HOME wants the harness
// paths moved, never the cache — hand the child this one. Both are captured at
// import, so the value survives a test module that changes HOME before
// importing this helper.
let invokingDenoDir = Deno.env.get('TEST_DENO_DIR') || denoCache

export let denoDir = () => invokingDenoDir

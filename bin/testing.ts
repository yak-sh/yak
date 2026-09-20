// The test tier's two primitives and its one sanctioned wait. A `slow` test
// rides real subprocesses, server boots, or git worktrees — the heavy tier —
// and only runs under TASKS_SLOW, so the default `deno task test` stays a few
// seconds and `deno task test:all` runs everything. A fast test never sleeps a
// fixed span: it yields with `tick` and waits on a fact with `until`, both
// deterministic, so nothing pads for a settle that a loaded box would stretch
// past the pad. A fixed sleep lives only behind `slow()`, where the real
// process it waits on is the point. It imports nothing but the runtime, so a
// test may reach for these primitives without pulling a database, a server or
// a package's module graph in behind them.
//
// The speed bar (bin/test-budget.ts) is ADVISORY, not a wall (T-17785): it lists
// tests over 1ms slowest-first but exits 0 on the budget alone, turning fatal
// only under TASKS_FAST_STRICT=1. deno rounds durations, so a `(1ms)` line hides
// up to ~1.4ms. A test in the 2–9ms band is usually paying production apply()
// cost rather than trimmable setup: don't chase it by rewriting the test,
// chase it by opening the cheaper graph (@yaks/sqlite `open` over `:memory:`
// with only the words the test asserts on).

// The one module cache this box has. A probe may move HOME freely and still
// write here, because DENO_DIR is pinned in every session shell's environment
// (etc/tasks-tmux.service); the platform defaults below are the fallback for a
// box that never pinned it.
let denoCache = (() => {
  let configured = Deno.env.get('DENO_DIR')
  if (configured) return configured
  let home = Deno.env.get('HOME')
  if (Deno.build.os == 'darwin') return `${home}/Library/Caches/deno`
  if (Deno.build.os == 'windows') return `${Deno.env.get('LOCALAPPDATA')}\\deno`
  return `${Deno.env.get('XDG_CACHE_HOME') ?? `${home}/.cache`}/deno`
})()

// A heavy test: skipped unless TASKS_SLOW opts in. Takes the same two shapes
// Deno.test does — (name, fn) and (name, opts, fn) — and folds in the ignore.
type Fn = () => void | Promise<void>
export let slow = (
  name: string,
  a: Fn | Omit<Deno.TestDefinition, 'name' | 'fn'>,
  b?: Fn,
) =>
  Deno.test({
    ...(b ? a as object : {}),
    name,
    fn: (b ?? a) as Fn,
    ignore: !Deno.env.get('TASKS_SLOW'),
  })

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
): Promise<T> => {
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

// The pinned module cache (`denoCache` above), with the runner's own
// TEST_DENO_DIR ahead of it so a suite can be pointed at a scratch cache. A
// test that redirects HOME wants the harness paths moved, never the cache —
// hand the child this one. Both are captured at import, so the value survives
// a test module that changes HOME before importing this helper.
let invokingDenoDir = Deno.env.get('TEST_DENO_DIR') || denoCache

export let denoDir = () => invokingDenoDir

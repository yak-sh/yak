// The test tier's two primitives and its one sanctioned wait. A `slow` test
// rides real subprocesses, server boots, or git worktrees — the heavy tier —
// and only runs under TASKS_SLOW, so the default `deno task test` stays a few
// seconds and `deno task test:all` runs everything. A fast test never sleeps a
// fixed span: it yields with `tick` and waits on a fact with `until`, both
// deterministic, so nothing pads for a settle that a loaded box would stretch
// past the pad. A fixed sleep lives only behind `slow()`, where the real
// process it waits on is the point. The migrated-db clone (freshDb) lives in
// testdb.ts, not here, so importing these primitives never pulls in db.ts —
// this module stays free of the DB_PATH import-order discipline db.ts carries.

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
  do {
    let v = await fact()
    if (v) return v
    await new Promise((go) => setTimeout(go, poll))
  } while (Date.now() < deadline)
  throw new Error(
    `until: timed out after ${timeout}ms waiting for ${
      typeof label == 'function' ? label() : label
    }`,
  )
}

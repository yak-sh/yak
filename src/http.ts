// The graph HTTP door shared by headless clients. A watched server may vanish
// for a few seconds between processes; transport failures wait for its return.
// HTTP status responses are never retried — callers own their semantics.

type Fetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

// The restart-tolerance schedule. An operator (or the test suite pointed at a
// dead host) overrides it with TASKS_BACKOFF — comma-separated ms, empty string
// = fail on the first refusal. Read once, guarded: the browser has no Deno and
// keeps the default rather than throwing on the env read.
let env = (k: string) => {
  try {
    return typeof Deno == 'undefined' ? undefined : Deno.env.get(k)
  } catch {
    return undefined
  }
}
let schedule = (v = env('TASKS_BACKOFF')) =>
  v == null
    ? [100, 200, 400, 800, 1600, 3200]
    : v
    ? v.split(',').map(Number)
    : []
let BACKOFF = schedule()
let sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))
let message = (e: unknown) => e instanceof Error ? e.message : String(e)
let replayable = (init?: RequestInit) =>
  ['GET', 'HEAD'].includes((init?.method ?? 'GET').toUpperCase())

export let request = async (
  input: string | URL,
  init?: RequestInit,
  run: Fetch = fetch,
  pause: (ms: number) => Promise<void> = sleep,
) => {
  // A rejected write may have committed before its response vanished.
  if (!replayable(init)) return run(input, init)
  let last: unknown
  for (let ms of [0, ...BACKOFF]) {
    if (ms) await pause(ms)
    try {
      return await run(input, init)
    } catch (e) {
      last = e
    }
  }
  let waited = BACKOFF.reduce((sum, ms) => sum + ms, 0) / 1000
  throw new Error(
    `tasks server unavailable after ${BACKOFF.length + 1} attempts over ` +
      `${waited}s: ${message(last)}`,
    { cause: last },
  )
}

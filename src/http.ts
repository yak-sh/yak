// The graph HTTP door shared by headless clients. A watched server may vanish
// for a few seconds between processes; transport failures wait for its return.
// HTTP status responses are never retried — callers own their semantics.

type Fetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

// The process environment as the wire sees it, guarded: the browser has no
// Deno and reads nothing rather than throwing. client.ts reads its host and
// identity through this same door, so the wire names no runtime of its own.
export let env = (k: string) => {
  try {
    return typeof Deno == 'undefined' ? undefined : Deno.env.get(k)
  } catch {
    return undefined
  }
}
// The restart-tolerance schedule. An operator (or the test suite pointed at a
// dead host) overrides it with TASKS_BACKOFF — comma-separated ms, empty string
// = fail on the first refusal. Read once.
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
  backoff: number[] = BACKOFF,
) => {
  // A rejected write may have committed before its response vanished.
  if (!replayable(init)) return run(input, init)
  let last: unknown
  for (let ms of [0, ...backoff]) {
    if (ms) await pause(ms)
    try {
      return await run(input, init)
    } catch (e) {
      last = e
    }
  }
  let waited = backoff.reduce((sum, ms) => sum + ms, 0) / 1000
  throw new Error(
    `tasks server unavailable after ${backoff.length + 1} attempts over ` +
      `${waited}s: ${message(last)}`,
    { cause: last },
  )
}

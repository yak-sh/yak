// The graph HTTP door shared by headless clients. A watched server may vanish
// for a few seconds between processes; transport failures wait for its return.
// HTTP status responses are never retried — callers own their semantics.
//
// It is also the one place every headless request passes, so `task --timing`
// says its line from here (timing.ts) and no verb has to opt in.

import { noted } from './timing.ts'

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
  let answered = async () =>
    noted(init?.method ?? 'GET', input, await run(input, init))
  // A rejected write may have committed before its response vanished.
  if (!replayable(init)) return answered()
  let last: unknown
  for (let ms of [0, ...backoff]) {
    if (ms) await pause(ms)
    try {
      return await answered()
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

// How many times the account API's fetch sends a call that Cloudflare answers
// with one status each time, or drops (`null`), and what the caller gets.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { resent } from './workers_api.ts'

type Call = [string, number | null, boolean?]

let sends = async ([method, status, idempotent]: Call) => {
  let n = 0
  let pauses: number[] = []
  let wait = (ms: number) => {
    pauses.push(ms)
    return Promise.resolve()
  }
  let was = globalThis.fetch
  globalThis.fetch = (() => {
    n++
    return status == null
      ? Promise.reject(new TypeError('Network connection lost.'))
      : Promise.resolve(new Response(null, { status }))
  }) as typeof fetch
  try {
    let got = await resent(
      'https://api.cloudflare.test/x',
      { method },
      idempotent == null ? {} : { idempotent },
      wait,
    ).then((r) => r.status, (e: Error) => e.name)
    assertEquals(pauses, [500, 2_000, 6_000].slice(0, n - 1))
    return [n, got]
  } finally {
    globalThis.fetch = was
  }
}

test("Cloudflare's own failures are sent again; a refusal once, and a POST or a PATCH unless it only reads", async () => {
  let calls: [Call, [number, number | string]][] = [
    [['GET', 500], [4, 500]],
    [['PUT', 503], [4, 503]],
    [['DELETE', 429], [4, 429]],
    [['GET', null], [4, 'Unavailable']],
    [['GET', 200], [1, 200]],
    [['GET', 404], [1, 404]],
    [['PUT', 400], [1, 400]],
    [['DELETE', 403], [1, 403]],
    [['POST', 500], [1, 500]],
    [['PATCH', null], [1, 'TypeError']],
    // A query that only reads, as an analytics read is.
    [['POST', 500, true], [4, 500]],
    [['POST', null, true], [4, 'Unavailable']],
    [['POST', 403, true], [1, 403]],
  ]
  let got = []
  for (let [call] of calls) got.push(await sends(call))
  assertEquals(got, calls.map(([, want]) => want))
})

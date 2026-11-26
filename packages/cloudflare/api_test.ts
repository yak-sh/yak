// How many times the account API's fetch sends a call that Cloudflare answers
// with one status each time, or drops (`null`), and what the caller gets.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { resent } from './api.ts'

type Call = [string, number | null, boolean?, string?]

let sends = async ([method, status, idempotent, after]: Call) => {
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
      : Promise.resolve(
        new Response(null, {
          status,
          headers: after == null ? {} : { 'retry-after': after },
        }),
      )
  }) as typeof fetch
  try {
    let got = await resent(
      'https://api.cloudflare.test/x',
      { method },
      idempotent == null ? {} : { idempotent },
      wait,
    ).then((r) => r.status, (e: Error) => e.name)
    return [n, got, pauses]
  } finally {
    globalThis.fetch = was
  }
}

test("Cloudflare's own failures are sent again; a refusal once, a 429 after the wait it names, and a POST or a PATCH unless it only reads", async () => {
  let all = [500, 2_000, 6_000]
  let calls: [Call, [number, number | string, number[]]][] = [
    [['GET', 500], [4, 500, all]],
    [['PUT', 503], [4, 503, all]],
    [['GET', null], [4, 'Unavailable', all]],
    [['GET', 200], [1, 200, []]],
    [['GET', 404], [1, 404, []]],
    [['PUT', 400], [1, 400, []]],
    [['DELETE', 403], [1, 403, []]],
    [['POST', 500], [1, 500, []]],
    [['PATCH', null], [1, 'TypeError', []]],
    // A slower pace: sent again after the wait it names, and not at all
    // without one or past the longest pause.
    [['DELETE', 429, undefined, '1'], [4, 429, [1_000, 1_000, 1_000]]],
    [['DELETE', 429], [1, 429, []]],
    [['GET', 429, undefined, '300'], [1, 429, []]],
    // A query that only reads, as an analytics read is.
    [['POST', 500, true], [4, 500, all]],
    [['POST', null, true], [4, 'Unavailable', all]],
    [['POST', 403, true], [1, 403, []]],
    [['POST', 429, true], [1, 429, []]],
  ]
  let got = []
  for (let [call] of calls) got.push(await sends(call))
  assertEquals(got, calls.map(([, want]) => want))
})

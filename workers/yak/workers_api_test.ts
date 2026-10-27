// How many times the account API's fetch sends a call that Cloudflare answers
// with one status each time, or drops (`null`).
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { resends, resent } from './workers_api.ts'

resends.wait = () => Promise.resolve()

let sends = async ([method, status]: [string, number | null]) => {
  let n = 0
  let was = globalThis.fetch
  globalThis.fetch = (() => {
    n++
    return status == null
      ? Promise.reject(new TypeError('Network connection lost.'))
      : Promise.resolve(new Response(null, { status }))
  }) as typeof fetch
  try {
    await resent('https://api.cloudflare.test/x', { method }).catch(() => {})
  } finally {
    globalThis.fetch = was
  }
  return n
}

test("Cloudflare's own failures are sent again; a refusal, a POST or a PATCH once", async () => {
  let calls: [string, number | null][] = [
    ['GET', 500],
    ['PUT', 403],
    ['DELETE', 429],
    ['GET', null],
    ['GET', 200],
    ['GET', 404],
    ['PUT', 400],
    ['POST', 500],
    ['PATCH', null],
  ]
  let got = []
  for (let call of calls) got.push(await sends(call))
  assertEquals(got, [4, 4, 4, 4, 1, 1, 1, 1, 1])
})

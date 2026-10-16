// The app door forwards a page's resend identity; the Store owns receipt
// persistence and guarded duplicate writes (writes_test.ts). Keep this routing
// decision timed without signing in or booting the whole kernel for it.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { IDEMPOTENCY } from './door.ts'
import { resend } from './wire.ts'

let request = (key?: string) =>
  new Request('https://ada.yaks.app/ledger/api/apply', {
    method: 'POST',
    headers: key ? { [IDEMPOTENCY]: key } : {},
  })
let named = [request('once'), request('once')]
let bare = [request(), request()]
let empty = request('')

test("a page's resend under its key is the write it repeats", () => {
  assertEquals(named.map(resend), [
    { [IDEMPOTENCY]: 'once' },
    { [IDEMPOTENCY]: 'once' },
  ])
})

test("a page's unnamed resend leaves each attempt's identity to the store door", () => {
  assertEquals(bare.map(resend), [{}, {}])
  assertEquals(resend(empty), {})
})

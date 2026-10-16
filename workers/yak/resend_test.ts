// A page that sends a write again, because its first answer never came,
// names it with an idempotency key, and the store answers the resend as it
// answered the first. Unnamed, the resend is a second write, which the first's
// guard then refuses (apps.ts `/apply`, writes.ts `first`).
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { bearerFor, connector, kernel, signIn } from './probe.ts'

test("a page's resend under its key is the write it repeats", async () => {
  let k = await kernel()
  try {
    let owner = await signIn(k)
    let space = owner.email.split('@')[0]
    await connector(k, owner.cookie).tool('app_new', {
      slug: 'ledger',
      title: 'Ledger',
      access: 'private',
    })
    let token = await bearerFor(k, owner.cookie)
    let send = async (eid: string, key?: string) => {
      let r = await k.at(`${space}.${k.host}`, '/ledger/api/apply', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...(key ? { 'idempotency-key': key } : {}),
        },
        body: JSON.stringify([{
          entity: { eid },
          $was: { doc: { title: null } },
          doc: { title: 'Bought' },
        }]),
      })
      await r.body?.cancel()
      return r.status
    }
    let named = crypto.randomUUID(), bare = crypto.randomUUID()
    assertEquals([await send(named, 'once'), await send(named, 'once')], [
      200,
      200,
    ])
    assertEquals([await send(bare), await send(bare)], [200, 409])
  } finally {
    await k.stop()
  }
})

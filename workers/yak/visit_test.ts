// A visitor to an open app, through the page's own door (T-37881, T-37896):
// they add rows, change only their own, never touch the shop's prices or say
// an order was paid, and send at a visitor's size and pace. The owner is not
// held to any of it.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { client, connector, kernel, seed, signedIn } from './probe.ts'

Deno.test(
  'a visitor to an open app adds, and changes only what they wrote',
  async () => {
    let k = await kernel()
    try {
      let { cookie } = await seed(k, [{ slug: 'fair67', apps: ['guests'] }])
      await connector(k, cookie).tool('app_set', {
        space: 'fair67',
        app: 'guests',
        access: 'open',
      })
      let host = 'fair67.yaks.app'
      let owner = client(k, host, 'guests', cookie)
      let anybody = client(k, host, 'guests')
      let kim = client(
        k,
        host,
        'guests',
        await signedIn(k, crypto.randomUUID()),
      )
      let status = async (c: typeof owner, ...b: unknown[]) => {
        let r = await c.post(b)
        await r.body?.cancel()
        return r.status
      }
      // The page door answers every refusal the store makes as 400 `refused`,
      // carrying the store's own sentence (apps.ts `/apply`).
      let denied = async (c: typeof owner, b: unknown) => {
        let r = await c.post([b])
        let said = await r.text()
        assertEquals(r.status, 400, `${JSON.stringify(b)}: ${said}`)
        assertStringIncludes(said, 'may not write')
      }
      let entry = { entity: { eid: 'entry' }, doc: { title: 'Welcome' } }
      let mug = { entity: { eid: 'mug' }, doc: { title: 'Mug' } }
      assertEquals(await status(owner, entry), 200)
      assertEquals(
        await status(owner, { ...mug, product: { price_cents: 2800 } }),
        200,
      )

      // Nothing of the owner's moves, whoever the visitor is.
      for (let c of [anybody, kim]) {
        for (
          let b of [
            { entity: { eid: 'mug' }, product: { price_cents: 1 } },
            { entity: { eid: 'cheap' }, product: { price_cents: 1 } },
            { entity: { eid: 'sold' }, order: {} },
            { entity: { eid: 'entry' }, doc: { title: 'Gone' } },
            { entity: { eid: 'entry' }, $delete: true },
          ]
        ) await denied(c, b)
      }
      let [held] = await owner.get('.eid=mug,entry&.product')
      assertEquals((held.product as { price_cents: number }).price_cents, 2800)
      assertEquals((await owner.get('.eid=entry')).length, 1)

      // They add. Signed in, what they added is theirs to change and delete.
      let hi = { entity: { eid: 'hi' }, doc: { title: 'Hi' } }
      assertEquals(await status(anybody, hi), 200)
      await denied(anybody, { ...hi, doc: { title: 'Yo' } })
      let mine = { entity: { eid: 'kims' }, doc: { title: 'Kim was here' } }
      assertEquals(await status(kim, mine), 200)
      assertEquals(await status(kim, { ...mine, doc: { title: 'Kim' } }), 200)
      assertEquals(
        await status(kim, { entity: { eid: 'kims' }, $delete: true }),
        200,
      )

      // A visitor's write is a visitor's size.
      let big = await anybody.post([{
        entity: { eid: 'big' },
        doc: { title: 'x', body: 'x'.repeat(20_000) },
      }])
      assertEquals(big.status, 413)
      assertEquals((await big.json()).error.code, 'visit_too_large')
      assertEquals(
        await status(owner, { ...entry, doc: { body: 'x'.repeat(20_000) } }),
        200,
      )

      // And a visitor's pace: thirty a minute, then the door says wait.
      let paced = 0
      for (let i = 0; i < 40 && !paced; i++) {
        let r = await anybody.post([{
          entity: { eid: `n${i}` },
          doc: { title: 'n' },
        }])
        if (r.status == 429) {
          paced = i
          assertEquals((await r.json()).error.code, 'too_many_writes')
        } else await r.body?.cancel()
      }
      assert(paced, 'thirty-one writes in a minute were never refused')
      // The owner writes on, uncounted.
      for (let i = 0; i < 5; i++) {
        assertEquals(
          await status(owner, {
            entity: { eid: `o${i}` },
            doc: { title: 'o' },
          }),
          200,
        )
      }
    } finally {
      await k.stop()
    }
  },
)

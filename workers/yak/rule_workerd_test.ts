// A rule an app declared, running inside the deployed Worker, on the app's own
// clock. Nothing here is code: the app ships a `rule: true` entry in its own
// vocab.json, writes a row wearing a `wake`, and the row comes back wearing
// what the rule said — because the object holding it armed its own Durable
// Object alarm and fired the wake when it came due (D-37562).
//
// What this proves that no in-process test can is the two things the runtime
// owns. The overlay: a rule is a query over the batch as though it had landed,
// and @yaks/sqlite makes the batch readable by prefixing the statement with a
// CTE per component it moved. It was temp tables shadowing the committed ones
// until this test ran — a Durable Object's SQLite refuses a temp object
// outright (`not authorized: SQLITE_AUTH`), so the overlay had to become
// something a query carries rather than something a database is left holding.
// And the alarm: the wake's own `at` is the clock here, so a row written a
// second ahead is delivered by workerd itself, to an object no request is
// touching.

import type { Bundle } from '@yaks/graph'
import { assert, assertEquals } from '@std/assert'
import { until } from '../../bin/testing.ts'
import { client, connector, kernel, seed, txt, when } from './probe.ts'

// An app vocabulary with a rule in it. `vocabFile` in probe.ts only writes
// components; a rule is an entry of its own shape, so this one is written out.
let withRule = JSON.stringify({
  $defs: {
    plant: { properties: { name: txt } },
    watered: { properties: { by: txt, at: when } },
    // A plant whose wake has gone off has been watered. The gate is what makes
    // it fire once: after it writes, the entity has the mark.
    waters: {
      rule: true,
      description: 'a plant whose wake has fired is watered',
      match: '.plant, .wake, .fired, +!watered, +watered.by=wake',
    },
  },
})

Deno.test(
  'an app rule fires on its own alarm inside the deployed Worker',
  async () => {
    let k = await kernel()
    try {
      let { cookie } = await seed(k, [{ slug: 'jeff65', apps: ['garden'] }])
      let app = client(k, 'jeff65.yaks.app', 'garden', cookie)
      assertEquals((await app.put('/vocab.json', withRule)).status, 200)
      await app.put('/index.html', '<!doctype html><h1>Garden</h1>')
      await connector(k, cookie).tool('app_deploy', {
        space: 'jeff65',
        app: 'garden',
      })

      // A plant with no wake at all: the rule says nothing about it.
      let r = await app.post([{
        entity: { eid: 'cactus' },
        plant: { name: 'cactus' },
      }])
      assertEquals(r.status, 200, await r.text())
      assertEquals(((await app.get('.watered')) as Bundle[]).length, 0)

      // A plant that asks to be come back to, a second from now. Nobody polls
      // for it: the store arms its object, the runtime delivers the alarm, the
      // tick writes `fired`, and the rule matches that batch as though it had
      // landed — which is the overlay.
      await app.post([{
        entity: { eid: 'fern' },
        plant: { name: 'fern' },
        wake: {
          at: new Date(Date.now() + 1000).toISOString(),
          note: 'water me',
        },
      }])
      let watered = await until(
        async () => {
          let rows = (await app.get('.watered&?wake&?fired')) as Bundle[]
          return rows.length ? rows : undefined
        },
        { timeout: 20_000, poll: 250, label: 'the fern to be watered' },
      ) as Bundle[]
      assertEquals(watered.length, 1)
      assertEquals(watered[0].entity.eid, 'fern')
      assertEquals((watered[0].watered as { by: string }).by, 'wake')
      // A one-shot is spent, and the firing is on the row that asked for it.
      assertEquals((watered[0].wake as { at: string | null }).at, null)
      assert(
        (watered[0].fired as { at: string }).at,
        'the wake says when it went',
      )

      // And it fires once: waking the plant again finds the gate closed.
      await app.post([{
        entity: { eid: 'fern' },
        wake: { at: new Date(Date.now() + 500).toISOString() },
      }])
      let first = (watered[0].fired as { at: string }).at
      await until(
        async () => {
          let [row] = (await app.get('.fired&?plant')) as Bundle[]
          return (row?.fired as { at: string } | undefined)?.at != first
        },
        { timeout: 20_000, poll: 250, label: 'the second firing' },
      )
      let again = (await app.get('.watered')) as Bundle[]
      assertEquals(again.length, 1)
      assertEquals((again[0].watered as { by: string }).by, 'wake')
    } finally {
      await k.stop()
    }
  },
)

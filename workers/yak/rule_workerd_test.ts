// A rule an APP declared, running inside the deployed Worker. Nothing here is
// code: the app ships a `rule: true` entry in its own vocab.json, writes a
// row, and the row comes back wearing what the rule said.
//
// What this proves that no in-process test can is the OVERLAY. A rule is a
// query over the batch as though it had landed, and @yaks/sqlite makes the
// batch readable by prefixing the statement with a CTE per component it
// moved. It was temp tables shadowing the committed ones until this test ran:
// a Durable Object's SQLite refuses a temp object outright (`not authorized:
// SQLITE_AUTH`), so the overlay had to become something a query carries
// rather than something a database is left holding.
//
// `rang` stands in for a wake here (app wakes are D-37562 and not built): the
// row is rung by hand, and the rule reacts to it exactly as it will when
// something else writes it.

import type { Bundle } from '@yaks/graph'
import { assert, assertEquals } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { client, connector, kernel, seed, txt, when } from './probe.ts'

// An app vocabulary with a rule in it. `vocabFile` in probe.ts only spells
// components; a rule is an entry of its own shape, so this one is written out.
let withRule = JSON.stringify({
  $defs: {
    alarm: { properties: { at: when } },
    rang: { properties: { at: when } },
    note: { properties: { said: txt } },
    // An alarm that has rung and has no note yet gets one. The gate is what
    // makes it fire once: after it writes, the entity HAS a note.
    noted: {
      rule: true,
      description: 'a rung alarm leaves a note',
      match: '.rang, +!note, +note.said=rang',
    },
  },
})

slow('an app rule fires inside the deployed Worker', async () => {
  let k = await kernel()
  try {
    let { cookie } = await seed(k, [{ slug: 'jeff', apps: ['clock'] }])
    let app = client(k, 'jeff.yaks.app', 'clock', cookie)
    assertEquals((await app.put('/vocab.json', withRule)).status, 200)
    await app.put('/index.html', '<!doctype html><h1>Clock</h1>')
    await connector(k, cookie).tool('app_deploy', {
      space: 'jeff',
      app: 'clock',
    })

    // An alarm that has NOT rung: the rule says nothing about it.
    let r = await app.post([{
      entity: { eid: 'w1' },
      alarm: { at: '2026-09-19T00:00:00.000Z' },
    }])
    assertEquals(r.status, 200, await r.text())
    assertEquals(((await app.get('.note!')) as Bundle[]).length, 0)

    // Fire it by hand. The rule matches the batch as though it had landed —
    // which is the overlay — and writes the note in the same transaction.
    assertEquals(
      (await app.post([{
        entity: { eid: 'w1' },
        rang: { at: '2026-09-19T00:00:01.000Z' },
      }])).status,
      200,
    )
    let noted = (await app.get('.note!')) as Bundle[]
    assertEquals(noted.length, 1)
    assertEquals(noted[0].entity.eid, 'w1')
    assertEquals((noted[0].note as { said: string }).said, 'rang')

    // And it fires ONCE: touching the entity again finds the gate closed.
    await app.post([{
      entity: { eid: 'w1' },
      rang: { at: '2026-09-19T00:00:02.000Z' },
    }])
    let again = (await app.get('.note!')) as Bundle[]
    assertEquals(again.length, 1)
    assert((again[0].note as { said: string }).said == 'rang')
  } finally {
    await k.stop()
  }
})

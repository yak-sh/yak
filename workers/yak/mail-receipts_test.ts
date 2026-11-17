// Signed receipts travel through the public store door with kernel authority.
import { equal, test } from '@yaks/testing'
import { webhook } from '../../packages/resend/testing.ts'
import { platform } from './directory-rows-probe.ts'
import { receipts } from './mail-receipts.ts'
import { operatorReceipt } from './operator-host.ts'
import { operatorMemory } from './operator-testing.ts'
import { letterFor } from './operator-channels.ts'
import { notification, updating } from './operator-updates.ts'
import { assertRejects } from '@std/assert'
import type { Comp } from '@yaks/graph'

let secret = 'whsec_' + btoa('a receiver key for these fixtures')
let env = {
  ...platform('mail-receipts').env,
  RESEND_WEBHOOK_SECRET: secret,
}

let operator = { store: operatorMemory() }
let person = crypto.randomUUID(), space = crypto.randomUUID()
let alert = notification({ to: person, by: space, words: 'Your app is ready.' })
// The letter it went as, sent: a row of its own carrying the notification.
let letter = letterFor(alert.entity.eid)
await operator.store.g.apply([alert, {
  entity: { eid: letter },
  mail: {
    from: 'ana@yaks.app',
    to: 'ana@example.com',
    target: alert.entity.eid,
    at: new Date().toISOString(),
  },
  doc: { title: 'Your app is ready.', body: 'Your app is ready.' },
  delivered: { at: new Date().toISOString() },
}], { trusted: true })
await operator.store.fx.work(operator.store.g)
await operator.store.fx.idle()
let operatorEnv = {
  ...env,
  BUILDER: {
    idFromName: (name: string) => {
      equal(name, space)
      return name
    },
    get: () => ({
      fetch: async (request: Request) => {
        equal(new URL(request.url).pathname, '/operator/receipt')
        equal(request.headers.get('x-yak-kernel'), '1')
        equal(request.headers.get('x-space-eid'), space)
        return await operatorReceipt(operator, await request.json())
      },
    }),
  },
}
let update = () => updating(operator.store, { person, space }, {})

test("a signed receipt for an Operator alert's letter threads the letter and leaves its Update be", async () => {
  let before = await update()
  let arrived = {
    type: 'email.delivered',
    data: {
      message_id: '<alert@example.com>',
      tags: {
        yak_letter: letter,
        yak_operator: space,
      },
    },
  }
  for (let _ of [0, 1]) {
    equal(
      (await receipts(await webhook(arrived, secret), operatorEnv, 'resend'))
        .status,
      200,
    )
  }
  let [row, note] = await operator.store.g.get([letter, alert.entity.eid])
  equal((row.mail as Comp).message_id, 'alert@example.com')
  equal([note.notification, note.mail], [alert.notification, undefined])
  equal(await update(), before)
  equal(await operator.store.g.read('.effect'), [])
  await assertRejects(
    () =>
      operatorReceipt(operator, {
        letter,
        id: 'different@example.com',
      }),
    Error,
    'disagrees with the recorded Message-ID',
  )
})

test('a receipt still waits for its recorded letter', async () => {
  await assertRejects(
    () =>
      operatorReceipt(operator, {
        letter: crypto.randomUUID(),
        id: 'unknown@example.com',
      }),
    Error,
    'awaits its recorded letter',
  )
})

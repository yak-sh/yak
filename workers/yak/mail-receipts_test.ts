// Signed receipts travel through the public store door with kernel authority.
import { equal, test } from '@yaks/testing'
import { webhook } from '../../packages/resend/testing.ts'
import { platform } from './directory-rows-probe.ts'
import { receipts } from './mail-receipts.ts'
import { operatorReceipt } from './operator-host.ts'
import { operatorMemory } from './operator-testing.ts'
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
await operator.store.g.apply([alert], { trusted: true })
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

test('a signed Operator alert receipt recovers its envelope and preserves its Update', async () => {
  let before = await update()
  let arrived = {
    type: 'email.delivered',
    data: {
      message_id: '<alert@example.com>',
      tags: {
        yak_letter: alert.entity.eid,
        yak_operator: space,
        yak_kind: 'alert',
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
  let [row] = await operator.store.g.get([alert.entity.eid])
  equal((row.mail as Comp).message_id, 'alert@example.com')
  equal(row.notification, alert.notification)
  equal((row.doc as Comp).body, 'Your app is ready.')
  equal(await update(), before)
  equal(await operator.store.g.read('.effect'), [])
  await assertRejects(
    () =>
      operatorReceipt(operator, {
        letter: alert.entity.eid,
        id: 'different@example.com',
        kind: 'alert',
      }),
    Error,
    'disagrees with the recorded Message-ID',
  )
})

test('an alert receipt still waits for its recorded notification', async () => {
  await assertRejects(
    () =>
      operatorReceipt(operator, {
        letter: crypto.randomUUID(),
        id: 'unknown@example.com',
        kind: 'alert',
      }),
    Error,
    'awaits its recorded letter',
  )
})

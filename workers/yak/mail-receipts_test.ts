// Signed receipts travel through the public store door with kernel authority.
import { equal, test } from '@yaks/testing'
import { webhook } from '../../packages/resend/testing.ts'
import { platform } from './directory-rows-probe.ts'
import { receipts } from './mail-receipts.ts'
import { mailTags } from './post.ts'
import { operatorReceipt } from './operator-host.ts'
import { operatorMemory } from './operator-testing.ts'
import { notification, updating } from './operator-updates.ts'
import { assertRejects } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import type { Namespace } from './door.ts'

let secret = 'whsec_' + btoa('a receiver key for these fixtures')
let id = '6ca77c5a-080e-44d4-a6df-0923d949763f'
// An app's letter, kept to its editors: only a trusted read sees it.
let row: Bundle = { entity: { eid: id }, mail: { from: 'home@yaks.app' } }
let writes = 0, names: string[] = []
let store: Namespace = {
  idFromName: (name) => {
    names.push(name)
    return name
  },
  get: () => ({
    fetch: async (request: Request) => {
      equal(request.headers.get('x-yak-kernel'), '1')
      if (new URL(request.url).pathname == '/apply') {
        equal(request.headers.get('x-yak-kernel'), '1')
        let batch = await request.json() as Bundle[]
        row = {
          ...row,
          mail: { ...row.mail as Comp, ...batch[0].mail as Comp },
        }
        writes++
        return Response.json(batch)
      }
      let trusted = new URL(request.url).searchParams.get('trusted') == '1'
      return Response.json(trusted ? [row] : [])
    },
  }),
}
let env = {
  ...platform('mail-receipts').env,
  STORE: store,
  RESEND_WEBHOOK_SECRET: secret,
}

test('an app receipt fills the recorded letter, whoever may read it, without sending another letter', async () => {
  let arrived = {
    type: 'email.sent',
    data: {
      message_id: '<thread@example.com>',
      tags: { yak_letter: id, ...mailTags('receipts/home') },
    },
  }
  equal(
    (await receipts(await webhook(arrived, secret), env, 'resend')).status,
    200,
  )
  equal(
    (await receipts(await webhook(arrived, secret), env, 'resend')).status,
    200,
  )
  equal((row.mail as Comp).message_id, 'thread@example.com')
  equal(writes, 1)
  equal(names.every((n) => n == 'receipts/home'), true)
})

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

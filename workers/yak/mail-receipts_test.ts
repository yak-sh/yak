// Signed receipts travel through the public store door with kernel authority.
import { equal, test } from '@yaks/testing'
import { webhook } from '../../packages/resend/testing.ts'
import { platform } from './directory-rows-probe.ts'
import { receipts } from './mail-receipts.ts'
import { mailTags } from './post.ts'
import type { Bundle, Comp } from '@yaks/graph'
import type { Namespace } from './door.ts'

let secret = 'whsec_' + btoa('a receiver key for these fixtures')
let id = '6ca77c5a-080e-44d4-a6df-0923d949763f'
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
      return Response.json([row])
    },
  }),
}
let env = {
  ...platform('mail-receipts').env,
  STORE: store,
  RESEND_WEBHOOK_SECRET: secret,
}

test('an app receipt fills the recorded letter without sending another letter', async () => {
  let arrived = {
    type: 'email.sent',
    data: {
      message_id: '<thread@example.com>',
      tags: { yak_letter: id, ...mailTags('receipts/home') },
    },
  }
  equal((await receipts(await webhook(arrived, secret), env)).status, 200)
  equal((await receipts(await webhook(arrived, secret), env)).status, 200)
  equal((row.mail as Comp).message_id, 'thread@example.com')
  equal(writes, 1)
  equal(names.every((n) => n == 'receipts/home'), true)
})

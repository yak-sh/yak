// An app's letter in workerd, through the one half a fake cannot stand for:
// the runtime's own `send_email` binding. The rest of the mailbox is
// mail_test.ts's, over the workerd stand-in.

import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { until } from '../../bin/testing.ts'
import { client, kernel, seed } from './probe.ts'

let ANA = 'c0000000-0000-4000-8000-000000000003'

let NOTE = 'd0000000-0000-4000-8000-000000000004'

type Vouch = {
  person?: string
  role?: string
  access?: string
  kernel?: boolean
}

// The letter as an app writes one: the recipient as an entity wearing an
// address, and the letter itself — a `doc` for the words, `mail` for the
// envelope, `deliver` for the ask.
let letter = (body = 'Bring a dish.') => [
  { entity: { eid: ANA }, email: { address: 'ana@example.com' } },
  {
    entity: { eid: NOTE },
    doc: { title: 'Potluck Friday', body },
    mail: {},
    deliver: { to: ANA },
  },
]

// mail_test.ts hands the letter to a fake. This hands it to the
// runtime's own `send_email` binding, under `wrangler dev`, because that is the
// half a fake cannot stand for: the payload post.ts builds is Email Sending's
// Workers API (`send({from, to, subject, text, html})` → `{messageId}`), and a
// runtime that does not speak it bounces every letter the platform sends.
Deno.test("an app's letter leaves through the runtime's own binding", async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'jeff29', apps: ['recipes'] }])
    let app = client(k, 'jeff29.yaks.app', 'recipes', them.cookie)
    await app.applied(letter())
    let settled = await until(async () => {
      let [one] = await app.get(
        `.entity.eid=${NOTE}&?mail&?delivered&?bounced`,
      ) as unknown as Bundle[]
      return one?.delivered || one?.bounced ? one : null
    }, { timeout: 30_000, poll: 250, label: 'the letter to come to rest' })
    assertEquals(settled!.bounced, undefined)
    assert(
      (settled!.mail as { message_id?: string }).message_id,
      'it left with an id',
    )
  } finally {
    await k.stop()
  }
})

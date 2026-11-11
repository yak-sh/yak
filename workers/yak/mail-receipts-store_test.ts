import { equal, test } from '@yaks/testing'
import { webhook } from '../../packages/resend/testing.ts'
import { platform } from './testing.ts'
import { receipts } from './mail-receipts.ts'
import { mailTags } from './post.ts'
import { KERNEL, metaOf } from './meta.ts'
import { storeOf } from './door.ts'
import { within } from './defects.ts'
import { assertRejects } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'

let secret = 'whsec_' + btoa('a receipt store key')
let hosted = platform('mail-receipts-store', { RESEND_WEBHOOK_SECRET: secret })
let name = 'receipts/home'
let app = crypto.randomUUID(), id = crypto.randomUUID()
let deleted = crypto.randomUUID()
let door = storeOf(hosted.env.STORE, name)
let graph = metaOf(door, KERNEL)
let deployed = await door('/vocab', {
  method: 'POST',
  body: '{}',
}, {
  ...KERNEL,
  'x-yak-app': app,
  'x-yak-access': 'public',
  'x-yak-mail': 'receipts@yaks.app',
})
equal(deployed.status, 200)
await graph.apply([id, deleted].map((eid) => ({
  entity: { eid },
  mail: { from: 'receipts@yaks.app' },
  doc: { title: 'A letter', body: 'The recorded words.' },
})))
await graph.apply([{ entity: { eid: deleted }, tombstone: {} }])

let delivered = async (letter: string) =>
  receipts(
    await webhook({
      type: 'email.sent',
      data: {
        message_id: '<recorded@example.com>',
        tags: { yak_letter: letter, ...mailTags(name) },
      },
    }, secret),
    hosted.env,
    'resend',
  )

test('a signed receipt reaches an editor-only letter through the Store query door', async () => {
  equal(await graph.query(`.entity.eid=${id}&*`), [])
  equal((await delivered(id)).status, 200)
  equal((await delivered(id)).status, 200)
  let [row] = await graph.query(`.entity.eid=${id}&*`, { trusted: true })
  equal(row.mail, {
    from: 'receipts@yaks.app',
    message_id: 'recorded@example.com',
  })
})

test('a signed receipt for a deleted Store letter acknowledges it without restoring it', async () => {
  equal((await delivered(deleted)).status, 200)
  let [row] = await graph.query(`.entity.eid=${deleted}&*`, {
    trusted: true,
    graves: true,
  })
  equal(row.tombstone, {})
  equal(row.mail, undefined)
})

test('a signed receipt for an unknown Store letter still waits and reports which letter it needs', async () => {
  let missing = crypto.randomUUID(), reports: Bundle[] = []
  await assertRejects(
    () =>
      within(
        {
          ERRORS: {
            send: (rows: Bundle[]) => {
              reports.push(...rows)
              return Promise.resolve()
            },
          },
        },
        {},
        () => delivered(missing),
      ),
    Error,
    'awaits its recorded letter',
  )
  equal(reports.length, 1)
  equal((reports[0].error as Comp).tags, {
    request: 'mail receipt',
    provider: 'resend',
    store: name,
    letter: missing,
  })
})

import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { routes } from './routes.ts'
import { webhook } from './testing.ts'

let secret = 'whsec_' + btoa('a shared endpoint key for testing')
let letter = '21491aa7-e2c1-4631-8465-0414f7195261'
let sent = (tags: Record<string, string>) => ({
  type: 'email.sent',
  data: {
    email_id: 'provider-only',
    message_id: '<thread@example.com>',
    tags: { yak_letter: letter, ...tags },
  },
})

test('a receipt route retries an early delivery and updates the same letter once', async () => {
  let record: Bundle | undefined
  let writes = 0, reports: unknown[] = []
  let [route] = routes({
    graph: {
      get: () => Promise.resolve(record ? [record] : []),
      apply: (bundles) => {
        writes++
        record = {
          entity: { eid: letter },
          mail: { message_id: 'thread@example.com' },
        }
        return Promise.resolve(bundles)
      },
    },
    report: (error) => void reports.push(error),
  }, { tags: { yak_host: 'box' }, receipts: { secret } })
  let send = async (tags = { yak_host: 'box' }, key = secret) =>
    (await route.handle(await webhook(sent(tags), key))).status
  equal(route.path, '/mail/resend')
  equal(await send(), 503)
  record = { entity: { eid: letter }, mail: { from: 'hello@example.com' } }
  equal(await send({ yak_host: 'elsewhere' }), 200)
  equal(writes, 0)
  equal(await send(), 200)
  equal(await send(), 200)
  equal(record.mail, { message_id: 'thread@example.com' })
  equal(writes, 1)
  equal(reports.length, 1)
  equal(await send({ yak_host: 'box' }, 'whsec_' + btoa('another key')), 401)
})

test('a sender with no receipts configured adds no route', () => {
  equal(routes({ graph: { get: () => Promise.resolve([]) } } as never), [])
})

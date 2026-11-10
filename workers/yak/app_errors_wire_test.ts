import { equal, test } from '@yaks/testing'
import { token } from '@yaks/graph'
import * as apps from './apps.ts'
import { appStore } from './directory.ts'
import { ADA, ADA_OWNS, as, platform, seeded, visit } from './serving-probe.ts'

let p = platform()
let { space, app } = await seeded(p.env, 'private')
let graph = appStore(p.env.STORE, space, app)
let id = crypto.randomUUID()
await graph('/apply', {
  method: 'POST',
  body: JSON.stringify([{ entity: { eid: id }, doc: { title: 'Kept' } }]),
}, ADA_OWNS)
let cookie = await as(ADA)

test('an app write preserves the stale error name for recoverable compare-and-set claims', async () => {
  let response = await apps.fetch(
    visit('/cookbook/api/apply', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        entities: [{
          entity: { eid: id },
          doc: { title: 'Overwritten' },
          $was: { doc: { title: token('Before') } },
        }],
      }),
    }),
    p.env,
  )
  equal(response.status, 409)
  let body = await response.json()
  equal(body.error.code, 'refused')
  equal(body.error.name, 'Stale')
  let kept = await graph(
    '/query?q=' + encodeURIComponent('.entity.eid=' + id),
    {},
    ADA_OWNS,
  )
  equal((await kept.json())[0].doc.title, 'Kept')
})

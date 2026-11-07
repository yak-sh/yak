// A signed provider callback can reach only the tracker scope its sender named.
import { equal, test } from '@yaks/testing'
import { webhook } from '../../packages/resend/testing.ts'
import { type Env, worker } from './worker.ts'
import { authorize } from './auth.ts'
import { platform } from './core.ts'

let secret = 'whsec_' + btoa('a receiver key for these fixtures')
let requests: Request[] = []
let env: Env = {
  TRACKER_SECRET: 'tracker-fixture',
  RESEND_WEBHOOK_SECRET: secret,
  TRACKERS: {
    getByName: (scope) => ({
      fetch: async (req) => {
        equal(scope, platform)
        let access = await authorize(req, env.TRACKER_SECRET, platform)
        equal(access?.ingest, true)
        equal(new URL(req.url).pathname, '/mail/receipt')
        requests.push(req)
        return Response.json({ ok: true })
      },
      ingest: () => Promise.resolve(),
      monitor: () => Promise.resolve(),
      admitTrace: () => Promise.resolve({}),
      ingestTrace: () => Promise.resolve(true),
      settle: () => Promise.resolve(0),
      enroll: () => Promise.resolve(),
    }),
  },
}

test('tracker receipts use a vouched intake ticket and do not need a caller scope', async () => {
  let body = {
    type: 'email.sent',
    data: {
      message_id: '<tracker-thread@example.com>',
      tags: {
        yak_letter: '6ca77c5a-080e-44d4-a6df-0923d949763f',
        yak_tracker: platform,
      },
    },
  }
  let response = await worker(env).fetch(await webhook(body, secret))
  equal(response.status, 200)
  equal(requests.length, 1)
  equal(await requests[0].json(), {
    letter: '6ca77c5a-080e-44d4-a6df-0923d949763f',
    id: 'tracker-thread@example.com',
  })
})

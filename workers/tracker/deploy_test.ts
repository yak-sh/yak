// Deploy hooks prove changed-bundle activation and rollback without account
// credentials, paid resources, or a minute-long test clock.
import { equal, test, throws } from '@yaks/testing'
import { deploy, type Hooks } from './deploy.ts'
import { worker } from './worker.ts'
import { sign } from './auth.ts'
import { platform } from './core.ts'

let fixture = () => {
  let calls: string[] = []
  let now = 0
  let hooks: Hooks = {
    current: async () => ({ version: 'previous', hash: 'old' }),
    deploy: async () => {
      calls.push('deploy')
    },
    canary: async () => false,
    rollback: async (version) => {
      calls.push(`rollback:${version}`)
    },
    now: () => now,
    wait: async () => {
      now += 15_000
    },
  }
  return { hooks, calls }
}
test('unchanged bundle does not deploy; changed bundle requires a canary', async () => {
  let { hooks, calls } = fixture()
  equal(await deploy('old', hooks), false)
  equal(calls, [])
  hooks.canary = async () => true
  equal(await deploy('new', hooks), true)
  equal(calls, ['deploy'])
})
test('missing or unavailable canary rolls back within one minute', async () => {
  let { hooks, calls } = fixture()
  hooks.canary = async () => {
    throw Error('tracker unavailable')
  }
  await throws(() => deploy('new', hooks))
  equal(calls, ['deploy', 'rollback:previous'])
  equal(hooks.now(), 60_000)
})
test('canary publishes only a server-minted platform error through the queue', async () => {
  let sent: unknown[] = []
  let secret = 'scratch'
  let w = worker({
    TRACKER_SECRET: secret,
    ERRORS: {
      send: async (rows) => {
        sent.push(rows)
      },
    },
    TRACKERS: {
      getByName: () => {
        throw Error('yak unavailable')
      },
    },
  })
  let url = `https://tracker.test/canary?scope=platform&hash=${'a'.repeat(64)}`
  equal((await w.fetch(new Request(url, { method: 'POST' }))).status, 403)
  let ticket = await sign({
    scope: platform,
    person: 'scratch',
    admin: true,
    exp: Date.now() / 1000 + 60,
  }, secret)
  let response = await w.fetch(
    new Request(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${ticket}` },
      body: '{"during":{"space":"poison"}}',
    }),
  )
  equal(response.status, 200)
  equal(sent.length, 1)
})

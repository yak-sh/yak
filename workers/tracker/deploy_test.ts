// Deploy hooks prove changed-bundle activation and rollback without account
// credentials, paid resources, or a minute-long test clock.
import { equal, test, throws } from '@yaks/testing'
import { canary, deploy, type Hooks } from './deploy.ts'
import { worker } from './worker.ts'
import { type State, Tracker } from './object.ts'
import { durable } from '../../packages/durable-object/testing.ts'
import type { Bundle } from '@yaks/graph'
import { platform } from './core.ts'

let fixture = () => {
  let calls: string[] = []
  let now = 0
  let hooks: Hooks = {
    current: () => Promise.resolve({ version: 'previous', hash: 'old' }),
    deploy: () => {
      calls.push('deploy')
      return Promise.resolve()
    },
    canary: () => Promise.resolve(false),
    rollback: (version) => {
      calls.push(`rollback:${version}`)
      return Promise.resolve()
    },
    now: () => now,
    wait: () => {
      now += 15_000
      return Promise.resolve()
    },
  }
  return { hooks, calls }
}
test('unchanged bundle does not deploy; changed bundle requires a canary', async () => {
  let { hooks, calls } = fixture()
  equal(await deploy('old', hooks), false)
  equal(calls, [])
  hooks.canary = () => Promise.resolve(true)
  equal(await deploy('new', hooks), true)
  equal(calls, ['deploy'])
})
test('missing or unavailable canary rolls back within one minute', async () => {
  for (
    let probe of [
      () => Promise.resolve(false),
      () => Promise.reject(Error('tracker unavailable')),
    ]
  ) {
    let { hooks, calls } = fixture()
    hooks.canary = probe
    await throws(() => deploy('new', hooks))
    equal(calls, ['deploy', 'rollback:previous'])
    equal(hooks.now(), 60_000)
  }
})
test('first deployment reports a missing canary without inventing a rollback', async () => {
  let { hooks, calls } = fixture()
  hooks.current = () => Promise.resolve({})
  await throws(() => deploy('new', hooks))
  equal(calls, ['deploy'])
})
let hash = 'a'.repeat(64)
let setup = () => {
  let sent: Bundle[][] = []
  let state: State = {
    id: { name: platform },
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    storage: {
      ...durable(),
      get: () => Promise.resolve(undefined),
      put: async () => {},
      setAlarm: async () => {},
    },
  }
  let secret = 'scratch'
  let object = new Tracker(state, { TRACKER_SECRET: secret })
  let w = worker({
    BUNDLE_HASH: hash,
    TRACKER_SECRET: secret,
    ERRORS: {
      send: (rows) => {
        sent.push(rows)
        return Promise.resolve()
      },
    },
    TRACKERS: { getByName: () => object },
  })
  let url = `https://tracker.test/canary?scope=platform&hash=${hash}`
  return { sent, object, w, url }
}
test('unsigned canary ignores caller data and reveals only its fresh grouped receipt', async () => {
  let { sent, object, w, url } = setup()
  let publish = async () => {
    let response = await w.fetch(
      new Request(url, {
        method: 'POST',
        body: '{"during":{"space":"poison"}}',
      }),
    )
    equal(response.status, 200)
    let { eid } = await response.json()
    return `${url}&eid=${eid}`
  }
  let receipt = await publish()
  equal(sent.length, 1)
  equal(sent[0][0].during, undefined)
  let read = async (url: string) => (await w.fetch(new Request(url))).json()
  equal(await read(receipt), { arrived: false })
  await object.ingest(sent[0])
  equal(await read(receipt), { arrived: false })
  await object.alarm()
  equal(await read(receipt), { arrived: true })
  // A canary from the same bundle cannot satisfy a later publication.
  let next = await publish()
  equal(await read(next), { arrived: false })
  equal(
    (await w.fetch(
      new Request('https://tracker.test/query?scope=platform&q=.error'),
    )).status,
    403,
  )
})
test('public canary rejects tenant scopes, other bundles and malformed receipts', async () => {
  let { sent, w, url } = setup()
  for (
    let [target, method, status] of [
      [
        url.replace('platform', '00000000-0000-4000-8000-000000000001'),
        'POST',
        403,
      ],
      [url.replace(hash, 'b'.repeat(64)), 'POST', 409],
      [url.replace(hash, 'invalid'), 'POST', 400],
      [url, 'GET', 400],
      [`${url}&eid=invalid`, 'GET', 400],
      [url, 'PUT', 405],
    ] as const
  ) {
    equal((await w.fetch(new Request(target, { method }))).status, status)
  }
  equal(sent, [])
})
test('build polls its unsigned canary receipt once published and rolls back if it never arrives', async () => {
  let { sent, w, object } = setup()
  let methods: string[] = []
  let probe = canary('https://tracker.test', hash, (input, init) => {
    let request = new Request(input, init)
    equal(request.headers.has('authorization'), false)
    methods.push(request.method)
    return w.fetch(request)
  })
  let { hooks, calls } = fixture()
  hooks.canary = probe
  await throws(() => deploy(hash, hooks))
  equal(calls, ['deploy', 'rollback:previous'])
  equal(sent.length, 1)
  equal(methods, ['POST', 'GET', 'GET', 'GET', 'GET'])
  await object.ingest(sent[0])
  await object.alarm()
  equal(await probe(), true)
  equal(sent.length, 1)
})

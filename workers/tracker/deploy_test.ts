// Deploy hooks prove changed-bundle activation and rollback without account
// credentials, paid resources, or a minute-long test clock.
import { clock, equal, test, throws } from '@yaks/testing'
import { canary, deploy, type Hooks } from './deploy.ts'
import { canary as receipt, worker } from './worker.ts'
import { grouped } from '@yaks/tracker'
import { json } from './door.ts'
import { matcher } from '@yaks/match'
import type { Bundle } from '@yaks/graph'
import { platform, vocab } from './core.ts'

let fixture = () => {
  let calls: string[] = []
  let time = clock()
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
    now: time.now,
    wait: () => time.advance(15_000),
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
  let secret = 'scratch'
  let received: Bundle[] = []
  let object = {
    fetch: (request: Request) =>
      Promise.resolve(
        request.headers.get('authorization') == 'Bearer scratch-ticket'
          ? json(
            matcher(new URL(request.url).searchParams.get('q')!, vocab)(
              received,
            ),
          )
          : json({ error: 'tracker scope denied' }, 403),
      ),
    ingest: (rows: Bundle[]) => {
      received.push(...rows)
      return Promise.resolve()
    },
    alarm: () => {
      received = received.map((row) =>
        row.error ? grouped(row, undefined, [])[0] : row
      )
      return Promise.resolve()
    },
    monitor: async () => {},
    admitTrace: () => Promise.resolve(false),
    ingestTrace: () => Promise.resolve(false),
  }
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
  }, (access, key) => {
    equal(key, secret)
    equal(access.scope, platform)
    equal(access.person, platform)
    equal(access.admin, true)
    return Promise.resolve('scratch-ticket')
  })
  let url = `https://tracker.test/canary?scope=platform&hash=${hash}`
  return { sent, object, w, url }
}
let publish = async (w: ReturnType<typeof worker>, url: string) => {
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
let read = async (w: ReturnType<typeof worker>, url: string) =>
  (await w.fetch(new Request(url))).json()
test('unsigned canary ignores caller data', async () => {
  let { sent, w, url } = setup()
  await publish(w, url)
  equal(sent.length, 1)
  equal(sent[0][0].during, undefined)
})
test('unsigned canary waits for delivery', async () => {
  let { w, url } = setup()
  let [row] = receipt(hash)
  equal(await read(w, `${url}&eid=${row.entity.eid}`), { arrived: false })
})
test('unsigned canary waits for grouping after delivery', async () => {
  let { sent, object, w, url } = setup()
  let receipt = await publish(w, url)
  await object.ingest(sent[0])
  equal(await read(w, receipt), { arrived: false })
})
test('unsigned canary reveals its grouped receipt', async () => {
  let { sent, object, w, url } = setup()
  let receipt = await publish(w, url)
  await object.ingest(sent[0])
  await object.alarm()
  equal(await read(w, receipt), { arrived: true })
})
test('an older grouped canary cannot satisfy a fresh publication', async () => {
  let { object, w, url } = setup()
  await object.ingest([{
    entity: { eid: '00000000-0000-4000-8000-000000000001' },
    error: {
      fault: `tracker-canary|${hash}`,
      bug: '00000000-0000-4000-8000-000000000002',
    },
  }])
  let next = await publish(w, url)
  equal(await read(w, next), { arrived: false })
})
test('unsigned caller cannot read tracker errors', async () => {
  let { w } = setup()
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
  let methods: string[] = []
  let arrived = false
  let eid = '00000000-0000-4000-8000-000000000001'
  let time = clock()
  let probe = canary('https://tracker.test', hash, (input, init) => {
    let request = new Request(input, init)
    let url = new URL(request.url)
    equal(request.headers.has('authorization'), false)
    equal(url.pathname, '/canary')
    equal(url.searchParams.get('hash'), hash)
    equal(url.searchParams.get('scope'), 'platform')
    methods.push(request.method)
    if (request.method == 'POST') return Promise.resolve(json({ eid }))
    equal(url.searchParams.get('eid'), eid)
    return Promise.resolve(json({ arrived }))
  }, (ms) => {
    let controller = new AbortController()
    time.after(ms, () => controller.abort())
    return controller.signal
  })
  let { hooks, calls } = fixture()
  hooks.canary = probe
  await throws(() => deploy(hash, hooks))
  equal(calls, ['deploy', 'rollback:previous'])
  equal(methods, ['POST', 'GET', 'GET', 'GET', 'GET'])
  arrived = true
  equal(await probe(), true)
  equal(methods, ['POST', 'GET', 'GET', 'GET', 'GET', 'GET'])
})

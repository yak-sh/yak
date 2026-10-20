// Deploy hooks prove changed-bundle activation and reporting without account
// credentials, paid resources, or waiting for deployment propagation.
import { clock, equal, ok, test, throws } from '@yaks/testing'
import { canary, deploy, Failed, type Hooks } from './deploy.ts'
import { canary as receipt, STALL, worker } from './worker.ts'
import { grouped } from '@yaks/tracker'
import { json } from './door.ts'
import { matcher } from '@yaks/match'
import type { Bundle, Comp } from '@yaks/graph'
import { platform, vocab } from './core.ts'
import { Tracker } from './object.ts'
import { sign } from './auth.ts'
import { durable } from '../../packages/durable-object/testing.ts'

let fixture = (step = 15_000) => {
  let calls: string[] = []
  let time = clock()
  // What the hooks read is what is deployed.
  let live = { hash: 'old' }
  let another = (hash: string) => live = { hash }
  let hooks: Hooks = {
    current: () => Promise.resolve(live),
    deploy: (hash) => {
      calls.push('deploy')
      another(hash)
      return Promise.resolve()
    },
    canary: () => Promise.resolve(false),
    report: () => Promise.resolve(void calls.push('report')),
    now: time.now,
    wait: () => time.advance(step),
  }
  return { hooks, calls, another }
}
test('unchanged bundle does not deploy; changed bundle requires a canary', async () => {
  let { hooks, calls } = fixture()
  equal(await deploy('old', hooks), false)
  equal(calls, [])
  hooks.canary = () => Promise.resolve(true)
  equal(await deploy('new', hooks), true)
  equal(calls, ['deploy'])
})
test('a missing or unavailable canary is reported after ten minutes, never rolled back', async () => {
  for (
    let probe of [
      () => Promise.resolve(false),
      () => Promise.reject(Error('tracker unavailable')),
    ]
  ) {
    let { hooks, calls } = fixture()
    hooks.canary = probe
    await throws(() => deploy('new', hooks))
    equal(calls, ['deploy', 'report'])
    equal(hooks.now(), 600_000)
  }
})
test('a failed canary is reported at once', async () => {
  let { hooks, calls } = fixture()
  hooks.canary = () => Promise.reject(new Failed('tracker canary failed'))
  await throws(() => deploy('new', hooks))
  equal(calls, ['deploy', 'report'])
  equal(hooks.now(), 0)
})
test('deployment waits for object convergence beyond one minute', async () => {
  let { hooks, calls } = fixture()
  hooks.canary = () => Promise.resolve(hooks.now() >= 360_000)
  equal(await deploy('new', hooks), true)
  equal(hooks.now(), 360_000)
  equal(calls, ['deploy'])
})
test('a build superseded by a newer deployment reports nothing', async () => {
  let { hooks, calls, another } = fixture()
  let wait = hooks.wait
  hooks.wait = () => (another('newer'), wait())
  equal(await deploy('new', hooks), false)
  equal(calls, ['deploy'])
})
let hash = 'a'.repeat(64)
let setup = (now: () => number = Date.now) => {
  let sent: Bundle[][] = []
  let secret = 'scratch'
  let received: Bundle[] = []
  let object = {
    // The bundle the object runs; null is an object from before `/bundle`.
    runs: hash as string | null,
    fetch: (request: Request) =>
      Promise.resolve(
        request.headers.get('authorization') != 'Bearer scratch-ticket'
          ? json({ error: 'tracker scope denied' }, 403)
          : new URL(request.url).pathname == '/bundle'
          ? object.runs
            ? json({ hash: object.runs })
            : json({ error: 'tracker route not found' }, 404)
          : json(
            matcher(new URL(request.url).searchParams.get('q')!, vocab)(
              received,
            ),
          ),
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
    CF_VERSION_METADATA: { id: '00000000-0000-4000-8000-000000000010' },
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
  }, now)
  let url = `https://tracker.test/canary?scope=platform&hash=${hash}`
  return { sent, object, w, url }
}
let publication = (url: string) =>
  new Request(
    `${url}&nonce=${crypto.randomUUID()}&at=${new Date().toISOString()}`,
    {
      method: 'POST',
      body: '{"during":{"space":"poison"}}',
    },
  )
let publish = async (
  w: ReturnType<typeof worker>,
  url: string,
  request = publication(url),
) => {
  let response = await w.fetch(request)
  equal(response.status, 200)
  let { eid } = await response.json()
  return `${url}&eid=${eid}`
}
let read = async (w: ReturnType<typeof worker>, url: string) =>
  (await w.fetch(new Request(url))).json()
let unsigned = setup()
let unsignedPublication = publication(unsigned.url)
await publish(unsigned.w, unsigned.url, unsignedPublication)

test('unsigned canary ignores caller data', () => {
  let { sent } = unsigned
  equal(sent.length, 1)
  let [failure, request] = sent[0]
  equal(failure.during, { request: request.entity.eid })
  equal((failure.error as Comp).tags, {
    script: 'yak-tracker',
    version: '00000000-0000-4000-8000-000000000010',
    entrypoint: 'fetch.canary',
  })
  equal(
    (request.request as Comp).url,
    'https://tracker.test/canary',
  )
})
test('canary republication retains its immutable capture', async () => {
  let { sent, w, url } = setup()
  let request = publication(url)
  let first = await publish(w, url, request.clone())
  equal(await publish(w, url, request.clone()), first)
  equal(sent[1], sent[0])
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
  let acknowledged = false, retried = false
  await w.queue([{
    body: sent[0],
    ack: () => void (acknowledged = true),
    retry: () => void (retried = true),
  }])
  equal([acknowledged, retried], [true, false])
  await object.alarm()
  equal(await read(w, receipt), { arrived: true })
})
// A canary delivered and grouped, and one published to an object from before
// content-hash eids, which admits UUID entities only.
let grouping = setup()
let groupingReceipt = await publish(grouping.w, grouping.url)
await grouping.object.ingest(grouping.sent[0])
await grouping.object.alarm()
let uuidOnly = setup()
let admits = uuidOnly.object.ingest
let uuids = Error('old object only admits UUID entities')
uuidOnly.object.ingest = (rows) =>
  rows.some((row) => !row.entity.eid.includes('-'))
    ? Promise.reject(uuids)
    : admits(rows)
let uuidOnlyReceipt = await publish(uuidOnly.w, uuidOnly.url)
test('canary waits for the object to run the deployed bundle', async () => {
  let { object, w } = grouping
  for (let runs of [null, 'b'.repeat(64)]) {
    object.runs = runs
    equal(await read(w, groupingReceipt), { arrived: false })
  }
  object.runs = hash
  equal(await read(w, groupingReceipt), { arrived: true })
})
test('canary cannot declare a UUID-only object ready for content hashes', async () => {
  let { sent, object, w } = uuidOnly
  let receipt = uuidOnlyReceipt
  let acknowledged = false, retried = false
  await w.queue([{
    body: sent[0],
    ack: () => void (acknowledged = true),
    retry: () => void (retried = true),
  }])
  await object.alarm()
  equal([acknowledged, retried], [false, true])
  equal(await read(w, receipt), { arrived: false })
})
let older = setup()
let olderReceipt = await publish(older.w, older.url)
await older.object.ingest(older.sent[0])
await older.object.alarm()
test('an older grouped canary cannot satisfy a fresh publication', async () => {
  let { w, url } = older
  equal(await read(w, olderReceipt), { arrived: true })
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
test('build republishes its canary and reports it missing if it never arrives', async () => {
  let methods: string[] = []
  let eid = '00000000-0000-4000-8000-000000000001'
  let time = clock()
  let probe = canary('https://tracker.test', hash, (input, init) => {
    let request = new Request(input, init)
    let url = new URL(request.url)
    equal(request.headers.has('authorization'), false)
    equal(url.searchParams.get('hash'), hash)
    equal(url.searchParams.get('scope'), 'platform')
    methods.push(`${request.method} ${url.pathname}`)
    if (url.pathname == '/canary/missing') return Promise.resolve(json({}))
    if (request.method == 'POST') return Promise.resolve(json({ eid }))
    equal(url.searchParams.get('eid'), eid)
    return Promise.resolve(json({ arrived: false }))
  }, (ms) => {
    let controller = new AbortController()
    time.after(ms, () => controller.abort())
    return controller.signal
  }, time.now)
  let { hooks, calls } = fixture(300_000)
  hooks.now = time.now
  hooks.wait = () => time.advance(300_000)
  hooks.canary = probe.arrived
  hooks.report = () => (calls.push('report'), probe.report())
  await throws(() => deploy(hash, hooks))
  equal(calls, ['deploy', 'report'])
  let publish = ['POST /canary', 'GET /canary']
  equal(methods, [...publish, ...publish, 'POST /canary/missing'])
})
test('a canary the tracker says failed stops the wait', async () => {
  let probe = canary(
    'https://tracker.test',
    hash,
    (input, init) =>
      Promise.resolve(
        new Request(input, init).method == 'POST'
          ? json({ eid: '00000000-0000-4000-8000-000000000001' })
          : json({ arrived: false, failed: true }),
      ),
  )
  ok(await throws(() => probe.arrived()) instanceof Failed)
})

let recoveryTime = clock(Date.now())
let recovery = setup(recoveryTime.now)
let recoveryProbe = canary(
  'https://tracker.test',
  hash,
  (input, init) => recovery.w.fetch(new Request(input, init)),
  () => new AbortController().signal,
  recoveryTime.now,
)
let readiness = [await recoveryProbe.arrived()]
// The first publication exhausted transport retries without reaching the DO.
await recoveryTime.advance(29_999)
readiness.push(await recoveryProbe.arrived())
let beforeRetry = recovery.sent.length
await recoveryTime.advance(1)
readiness.push(await recoveryProbe.arrived())
let acknowledged = false, retried = false
await recovery.w.queue([{
  body: recovery.sent[1],
  ack: () => void (acknowledged = true),
  retry: () => void (retried = true),
}])
await recovery.object.alarm()
readiness.push(await recoveryProbe.arrived())
test('lost canary delivery recovers with the same capture after convergence', () => {
  equal(readiness, [false, false, false, true])
  equal(beforeRetry, 1)
  equal(recovery.sent.length, 2)
  equal(recovery.sent[1], recovery.sent[0])
  equal([acknowledged, retried], [true, false])
})

test('canary publication refuses malformed or stale caller parameters', async () => {
  let { w, url, sent } = setup()
  let valid = publication(url).url
  for (
    let edit of [
      (url: URL) => url.searchParams.delete('nonce'),
      (url: URL) => url.searchParams.set('nonce', 'chosen-entity'),
      (url: URL) => url.searchParams.delete('at'),
      (url: URL) => url.searchParams.set('at', 'invalid'),
      (url: URL) =>
        url.searchParams.set(
          'at',
          new Date(Date.now() - 16 * 60_000).toISOString(),
        ),
      (url: URL) =>
        url.searchParams.set(
          'at',
          new Date(Date.now() + 2 * 60_000).toISOString(),
        ),
    ]
  ) {
    let target = new URL(valid)
    edit(target)
    equal((await w.fetch(new Request(target, { method: 'POST' }))).status, 400)
  }
  equal(sent, [])
})

// A platform object whose alarm has not run: its queue is stalled until the
// test runs it, so the canary's standing is read beside a pending grouping.
let stalled = new Tracker({
  id: { name: platform },
  storage: durable(),
  getWebSockets: () => [],
  acceptWebSocket: () => {},
}, { TRACKER_SECRET: 'scratch', BUNDLE_HASH: hash })
let later = Date.now()
let reports: Bundle[][] = []
let stalledWorker = worker(
  {
    BUNDLE_HASH: hash,
    TRACKER_SECRET: 'scratch',
    ERRORS: { send: (rows) => Promise.resolve(void reports.push(rows)) },
    TRACKERS: { getByName: () => stalled },
  },
  sign,
  () => later,
)
let nonce = crypto.randomUUID()
let canaryUrl = `https://tracker.test/canary?scope=platform&hash=${hash}`
let missingUrl = canaryUrl.replace('/canary?', '/canary/missing?') +
  `&nonce=${nonce}`
let { eid: stalledEid } = await (await stalledWorker.fetch(
  new Request(
    `${canaryUrl}&nonce=${nonce}&at=${new Date(later).toISOString()}`,
    {
      method: 'POST',
    },
  ),
)).json()
await stalled.ingest(reports[0])
let standing = [await read(stalledWorker, `${canaryUrl}&eid=${stalledEid}`)]
later += STALL + 1000
standing.push(await read(stalledWorker, `${canaryUrl}&eid=${stalledEid}`))
let missed = await stalledWorker.fetch(
  new Request(missingUrl, { method: 'POST' }),
)
let [report] = reports[1] ?? []
// The report reaches the tracker as a bug of its own, which owes a letter.
await stalled.ingest(reports[1])
await stalled.alarm()
standing.push(await read(stalledWorker, `${canaryUrl}&eid=${stalledEid}`))
let [opened] = await stalled.tracker!.graph.read(
  `.bug.fault="tracker-deploy|${hash}"`,
)
let late = await stalledWorker.fetch(
  new Request(missingUrl, { method: 'POST' }),
)

test('a stalled effect queue reads as a failed canary, not silence', () => {
  equal(standing, [
    { arrived: false },
    { arrived: false, failed: true },
    { arrived: true },
  ])
})
test('a missing canary is reported to the tracker with why, read there', () => {
  equal(missed.status, 200)
  equal((report.error as Comp).fault, `tracker-deploy|${hash}`)
  ok(String((report.exception as Comp).value).includes('effect queue'))
  ok(opened && !opened.archived)
})
test('an arrived canary is not reported missing', () => {
  equal(late.status, 409)
})

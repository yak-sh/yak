// A failed boot still serves refusals and retries on the next request. A
// read outage cannot affect trusted intake into another independently held DO.
// Mail activation and delivery run at pure and in-memory handler seams.
import { equal, ok, test } from '@yaks/testing'
import { ram } from '@yaks/ram'
import { capture } from '@yaks/tracker/report'
import { type State, Tracker } from './object.ts'
import { options, store, vocab } from './core.ts'
import { sign } from './auth.ts'
import { type Comp, graph } from '@yaks/graph'
import { notify } from '@yaks/tracker/effects'
import { activate, activation } from './mail.ts'
import { sending } from '@yaks/mail'
import { grouped } from '@yaks/tracker'
import { canary } from './worker.ts'
import { platform } from './core.ts'
import type { Message } from '@yaks/mail'

let space = '00000000-0000-4000-8000-000000000001'
test('postboot failure does not poison the object and reporting never throws', async () => {
  let alarms: number[] = []
  let state: State = {
    id: { name: space },
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    storage: {
      sql: {
        exec: () => {
          throw Error('scratch storage unavailable')
        },
      },
      transactionSync: (body) => body(),
      get: () => Promise.resolve(undefined),
      put: async () => {},
      setAlarm: (at) => {
        alarms.push(at)
        return Promise.resolve()
      },
    },
  }
  let secret = 'scratch'
  let object = new Tracker(state, {
    TRACKER_SECRET: secret,
    ERRORS: {
      send: () => Promise.reject(Error('reporting unavailable')),
    },
  })
  let ticket = await sign({
    scope: space,
    person: 'scratch',
    exp: Date.now() / 1000 + 60,
  }, secret)
  let request = () =>
    new Request('https://tracker.test/bugs', {
      headers: { authorization: `Bearer ${ticket}` },
    })
  // Suppress only this test's known fallback report, not the object failure.
  let report = console.error
  try {
    console.error = () => {}
    equal((await object.fetch(request())).status, 503)
  } finally {
    console.error = report
  }
  equal(object.tracker, undefined)
  equal(alarms.length, 1)
  object.tracker = store(ram(vocab, options), { sink: () => {} })
  equal((await object.fetch(request())).status, 200)
  await object.ingest(capture(Error('independent intake'), {
    sink: () => {},
    during: { space },
  }))
  equal((await object.tracker.graph.read('.error')).length, 1)
})

let at = '2026-10-02T00:00:00.000Z'
let env = {
  MAIL_FROM: 'task@bot.yak.sh',
  MAIL_TO: 'jeff@yak.sh',
  MAIL: { send: () => Promise.resolve({}) },
}
let setup = (since?: string, date = at, scope = platform) => ({
  ...activation(env, since, () => Date.parse(date)),
  store: scope,
  url: 'https://tracker.yak.sh',
})
let bug = (eid: string, at: string) => ({
  entity: { eid },
  created: { at },
  bug: { fault: eid, spot: `${eid}.ts` },
  doc: { title: `${eid} defect` },
})
let fixture = () => {
  let g = graph({
    vocab,
    storage: ram(vocab, options),
    clock: () => '2026-10-05T00:00:00.000Z',
  })
  let put = (rows: Parameters<typeof g.apply>[0]) =>
    g.apply(rows, { trusted: true, stamp: false })
  return { g, put }
}

test('mail activation persists its first date across restarts', async () => {
  let { g } = fixture(), saved = new Map<string, string>()
  let writes = 0
  let keeping = () => ({
    get: (key: string) => saved.get(key),
    set: (key: string, value: string) => {
      writes++
      saved.set(key, value)
    },
  })
  let first = await activate(g, env, keeping, () => Date.parse(at))
  equal(first.since, at)
  let second = await activate(
    g,
    env,
    keeping,
    () => Date.parse('2027-01-01T00:00:00Z'),
  )
  equal(second.since, at)
  equal(saved.get('mail-since'), at)
  equal(writes, 1)
  equal(((await g.get([platform]))[0].email as Comp).address, env.MAIL_TO)
})

test('disabled mail never opens activation metadata or reads the clock', async () => {
  let { g } = fixture()
  let unopened = () => {
    throw Error('disabled mail cannot activate')
  }
  equal(
    await activate(g, { MAIL_TO: env.MAIL_TO }, unopened, unopened),
    {},
  )
  equal(((await g.get([platform]))[0].email as Comp).address, env.MAIL_TO)
  equal(activation({}, undefined, () => 0), {})
})

test('a trace wake leaves mail activation for an ordinary wake', async () => {
  let object = new Tracker({
    id: { name: space },
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    storage: {
      sql: {
        exec: () => {
          throw Error('trace cannot initialize mail')
        },
      },
      transactionSync: (body) => body(),
      get: () => Promise.resolve(undefined),
      put: async () => {},
      setAlarm: async () => {},
    },
  }, env)
  object.tracker = store(ram(vocab, options), { sink: () => {} })
  await object.boot(false)
  equal((await object.tracker.graph.read('.email')).length, 0)
})

let openings = fixture()
await openings.put([
  bug('old', '2026-10-01T00:00:00Z'),
  bug('new', '2026-10-03T00:00:00Z'),
])
test('mail activation skips existing bugs and queues new openings', async () => {
  let { g } = openings, config = setup(undefined, at, space)
  await notify(g, 'old', config)
  await notify(g, 'new', config)
  let letters = await g.read('.mail *')
  equal(letters.length, 1)
  equal((letters[0].mail as Comp).target, 'new')
  equal(!!(await g.get(['old']))[0].notified, false)
})

let outbound = fixture()
let tenantMail = setup(undefined, at, space)
await outbound.put([
  tenantMail.recipient!,
  bug('before', '2026-10-01T00:00:00Z'),
  bug('after', '2026-10-03T00:00:00Z'),
])
await notify(outbound.g, 'before', tenantMail)
await notify(outbound.g, 'after', tenantMail)
let [outboundLetter] = await outbound.g.read('.mail *')
test('delivery sends once and preserves its receipt after a restart', async () => {
  let { g, put } = outbound
  let sent: Message[] = []
  let sender = {
    send: (message: Message) => {
      sent.push(message)
      return Promise.resolve({ id: 'sent-once' })
    },
  }
  let event = {
    entity: outboundLetter.entity,
    name: 'mail',
    kind: 'created' as const,
  }
  await sending({ sender })(event, g, put)
  await sending({ sender })(event, g, put)
  equal((await g.read('.mail')).length, 1)
  equal((outboundLetter.mail as Comp).target, 'after')
  equal(sent.length, 1)
  equal(sent[0].to, env.MAIL_TO)
  equal(sent[0].from, env.MAIL_FROM)
  ok(sent[0].text.includes('https://tracker.yak.sh/'))
  equal(
    ((await g.get([outboundLetter.entity.eid]))[0].mail as Comp).message_id,
    'sent-once',
  )
})

let replayed = fixture()
await replayed.put([bug('new', '2026-10-03T00:00:00Z')])
await notify(replayed.g, 'new', setup())
let [delivered] = await replayed.g.read('.mail *')
await replayed.put([{ entity: delivered.entity, delivered: {} }])
test('restarted notification replay marks a delivered opening without another letter', async () => {
  let { g } = replayed, config = setup(at, '2027-01-01T00:00:00Z')
  await notify(g, delivered.entity.eid, config)
  await notify(g, 'new', config)
  equal((await g.read('.mail')).length, 1)
  equal(!!(await g.get(['new']))[0].notified, true)
})

test('delayed openings still owe mail after eviction', async () => {
  let { g, put } = fixture(), config = setup(at, '2027-01-01T00:00:00Z')
  await put([bug('late', '2026-10-03T00:00:00Z')])
  await notify(g, 'late', config)
  let letters = await g.read('.mail *')
  equal(letters.length, 1)
  equal((letters[0].mail as Comp).target, 'late')
})

let archivedCanary = fixture()

test('deployment canaries remain archived after grouping and owe no mail', async () => {
  let { g } = archivedCanary, config = setup()
  let rows = canary('b'.repeat(64))
  let [occurrence, opening] = grouped(rows[0], undefined, [])
  await g.apply([...rows, occurrence, opening], { trusted: true })
  await notify(g, opening.entity.eid, config)
  equal((await g.read('.mail')).length, 0)
  equal(!!(await g.get([opening.entity.eid]))[0].archived, true)
})

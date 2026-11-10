// Push refusals fall back to another channel, or remain owed in the pool.
import { cleanup, clock, equal, match, test } from '@yaks/testing'
import type { Bundle, Comp } from '@yaks/graph'
import type { Binding } from '@yaks/cloudflare-mail'
import { vapidKey } from '@yaks/push'
import { browser } from '@yaks/push/testing'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory } from './operator-testing.ts'
import { notification } from './operator-updates.ts'
import { alert, pushRow } from './operator-alerts.ts'
import { endpoints } from './endpoints.ts'
import { caught, within } from './defects.ts'

let setup = async (email = false) => {
  let { env } = platform('operator-alerts-outage')
  let time = clock(Date.now())
  let reports: Bundle[] = [], letters: unknown[] = []
  env.ERRORS = { send: (rows) => (reports.push(...rows), Promise.resolve()) }
  env.MAIL = {
    send: (letter: Parameters<Binding['send']>[0]) => {
      letters.push(letter)
      return Promise.resolve({ messageId: 'sent' })
    },
  }
  env.PUSH_VAPID_KEY = JSON.stringify(await vapidKey())
  let status = 530, calls = 0
  let service = endpoints(globalThis).open(() => {
    calls++
    return new Response(status == 530 ? 'error code: 1033' : null, {
      status,
      headers: { 'retry-after': '7' },
    })
  })
  let tab = await browser(`${service.url}/browser`)
  let dir = directoryOf(env.STORE)
  let person = crypto.randomUUID(), space = crypto.randomUUID()
  await dir.apply({
    entities: [
      {
        entity: { eid: person },
        person: {},
        operator_alerts: { channel: 'push' },
        ...email ? { email: { address: 'outage@bot.yak.sh' } } : {},
      },
      { entity: { eid: space }, space: { slug: 'outage', store: 'outage' } },
      {
        entity: { eid: crypto.randomUUID() },
        member: { person, space, role: 'owner' },
      },
      pushRow(person, tab.subscription),
    ],
  })
  let store = operatorMemory(undefined, {
    clock: time,
    report: (error) => caught(error, { request: 'operator alert test' }),
  })
  cleanup(() => {
    store.fx.stop()
    return service.stop()
  })
  store.fx.handle({
    operator_alert: (event) => alert(env, store, event.entity.eid),
  })
  let note = notification({
    to: person,
    words: 'Your report is ready.',
    by: space,
  })
  await store.g.apply([note], { trusted: true })
  let work = () =>
    within(env, {}, async () => {
      await store.fx.work(store.g, undefined, { passes: 1 })
      await store.fx.idle()
    })
  let read = async () => (await store.g.get([note.entity.eid]))[0]
  let runs = () => store.g.read('.effect.handler=operator_alert')
  return {
    env,
    dir,
    person,
    store,
    time,
    reports,
    letters,
    work,
    read,
    runs,
    calls: () => calls,
    answer: (code: number) => status = code,
  }
}

let fallback = await setup(true)
let recovered = await setup()
let exhausted = await setup()
let permanent = await setup()

test('a refused push falls back to email, retains its subscription and completes once', async () => {
  await fallback.work()
  equal(fallback.letters.length, 1)
  equal(!!(await fallback.read()).delivered, true)
  equal((await fallback.dir.pushes(fallback.person)).length, 1)
  equal(await fallback.runs(), [])
  await fallback.work()
  equal([fallback.letters.length, fallback.calls(), fallback.reports.length], [
    1,
    1,
    0,
  ])
})

test('a push outage with no fallback is recorded and retried without bouncing or reporting a bug', async () => {
  await recovered.work()
  let [run] = await recovered.runs()
  match(run.effect, { state: 'pending', attempts: 1 })
  match(run.effect, {
    next: new Date(recovered.time.now() + 7000).toISOString(),
  })
  equal(
    String((run.effect as Comp).error).includes('530: error code: 1033'),
    true,
  )
  equal(
    [(await recovered.read()).delivered, (await recovered.read()).bounced],
    [undefined, undefined],
  )
  await recovered.work()
  equal(recovered.calls(), 1)
  recovered.answer(201)
  await recovered.time.advance(7000)
  await recovered.work()
  equal(!!(await recovered.read()).delivered, true)
  equal(await recovered.runs(), [])
  equal([recovered.calls(), recovered.reports.length], [2, 0])
})

test('an exhausted push outage stays recorded as a known refusal without a new bug', async () => {
  for (let i = 0; i < 3; i++) {
    await exhausted.work()
    await exhausted.time.advance(7000)
  }
  let [run] = await exhausted.runs()
  match(run.effect, { state: 'failed', attempts: 3, next: undefined })
  equal(
    String((run.effect as Comp).error).includes('530: error code: 1033'),
    true,
  )
  equal((await exhausted.read()).bounced, undefined)
  equal([exhausted.calls(), exhausted.reports.length], [3, 0])
})

test('a permanent push refusal without another route bounces without retrying', async () => {
  permanent.answer(403)
  await permanent.work()
  equal(
    String(((await permanent.read()).bounced as Comp).reason).includes('403'),
    true,
  )
  equal(await permanent.runs(), [])
  equal([permanent.calls(), permanent.reports.length], [1, 0])
})

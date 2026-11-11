// A report of the plans alone is each plan limit against its pace, and a
// topic's share is read against what its sessions used of each plan's week.
import { equal, test } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { link } from '@yaks/edge'
import { empty } from './tally.ts'
import { report, shared } from './tools.ts'
import { dayEid } from './window.ts'

test('the plans report is each limit against its pace, a line each', async () => {
  let { graph } = await compose({
    db: ':memory:',
    person: 'owner',
    plugins: ['@yaks/kernel', '@yaks/id', '@yaks/model', '@yaks/spend'],
  }, ['graph'])
  let now = Date.parse('2026-11-10T12:00:00Z')
  equal(
    await report(graph, { plans: true, now }),
    'No plan limit has been read.',
  )
  let limit = (
    alias: string,
    window: number,
    used: number,
    resets: string,
  ) => ({
    entity: { eid: alias },
    rate_limit: { provider: '$p', account: '$a', window, used, resets },
  })
  await graph.apply([
    { entity: { eid: '$p' }, provider: { name: 'claude' } },
    { entity: { eid: '$a' }, account: { home: '/h/.claude', provider: '$p' } },
    limit('week', 10080, 17.4, '2026-11-17T12:00:00Z'),
    limit('five', 300, 40, '2026-11-10T14:30:00Z'),
  ])
  equal((await report(graph, { plans: true, now })).split('\n'), [
    'claude week: 17% used, 0% of it gone, resets 2026-11-17 12:00 UTC',
    'claude five hours: 40% used, 50% of it gone, resets 2026-11-10 14:30 UTC',
  ])
})

// Two plans a week in, three topics (one below another, one with no share)
// and the sessions that worked for them, with what each ran up.
let box = async () => {
  let { graph } = await compose({
    db: ':memory:',
    person: 'owner',
    plugins: [
      '@yaks/kernel',
      '@yaks/id',
      '@yaks/edge',
      '@yaks/doc',
      '@yaks/task',
      '@yaks/session',
      '@yaks/model',
      '@yaks/topic',
      '@yaks/spend',
    ],
  }, ['graph'])
  let topic = (eid: string, share?: number) => ({
    entity: { eid },
    topic: { name: eid },
    doc: { title: eid },
    ...share == null ? {} : { attended: { share } },
  })
  let session = (eid: string, o: { topic?: string; parent?: string }) => ({
    entity: { eid },
    session: { id: eid, ...o.topic ? { topic: o.topic } : {} },
    ...o.parent ? { spawned: { parent: o.parent } } : {},
  })
  let plan = (dollars: number, sessions: Record<string, number>) => ({
    dollars,
    parts: {},
    sessions,
    tasks: {},
    models: {},
    entries: {},
  })
  let limit = (eid: string, account: string, resets: string) => ({
    entity: { eid },
    rate_limit: {
      provider: '$p',
      account,
      window: 10080,
      used: 20,
      resets,
      at: '2026-11-11T12:00:00Z',
    },
  })
  await graph.apply([
    { entity: { eid: '$p' }, provider: { name: 'claude' } },
    { entity: { eid: '$a' }, account: { home: '/h/.claude', provider: '$p' } },
    { entity: { eid: '$b' }, account: { home: '/h/.work', provider: '$p' } },
    limit('la', '$a', '2026-11-17T12:00:00Z'),
    // read before its week turned: it says when the week began, not its use
    limit('lb', '$b', '2026-11-10T12:00:00Z'),
  ])
  let [a, b] = (await graph.read('.account .order=account.home')).map((r) =>
    r.entity.eid
  )
  await graph.apply([
    topic('funnel', 0.25),
    topic('signup', 0.125),
    topic('pricing'),
    topic('loose'),
    link('funnel', 'contains', 'signup'),
    link('signup', 'contains', 'pricing'),
    session('head', { topic: 'funnel' }),
    session('worker', { parent: 'head' }),
    session('helper', { parent: 'worker' }),
    session('consult', { topic: 'pricing' }),
    session('oracle', { topic: 'loose' }),
    session('operator', {}),
    {
      entity: { eid: dayEid('2026-11-11') },
      spend: {
        ...empty('2026-11-11'),
        plans: {
          [a]: plan(400, {
            head: 40,
            worker: 30,
            helper: 10,
            consult: 20,
            oracle: 100,
            operator: 200,
          }),
          [b]: plan(8, { worker: 8 }),
        },
      },
    },
  ], { trusted: true })
  return { graph, a, b }
}
let now = Date.parse('2026-11-14T00:00:00Z')
let { graph, ...plans } = await box()

test("a topic's use is its session's and those of every session under it, on each plan", async () => {
  let [funnel, signup, rest] = await shared(graph, now)
  let a = { plan: plans.a, name: '.claude', gone: 0.5 }
  let b = { plan: plans.b, name: '.work', gone: 0.5 }
  equal(funnel, {
    topic: 'funnel',
    share: 0.25,
    keeps: 0.125,
    depth: 0,
    plans: [{ ...a, dollars: 80, used: 0.04 }, { ...b, dollars: 8 }],
  })
  equal(signup, {
    topic: 'signup',
    share: 0.125,
    keeps: 0.125,
    depth: 1,
    plans: [{ ...a, dollars: 20, used: 0.01 }, { ...b, dollars: 0 }],
  })
  equal(rest, {
    share: 0.75,
    keeps: 0.75,
    depth: 0,
    plans: [{ ...a, dollars: 300, used: 0.15 }, { ...b, dollars: 0 }],
  })
})

test('the report says each share in a line, and nothing of shares where none is set', async () => {
  let lines = (await report(graph, { now })).split('\n')
  let at = lines.findIndex((l) => l.startsWith('Shares'))
  equal(lines.slice(at + 1, at + 4).map((l) => l.split(':')[0]), [
    "  #funnel funnel keeps 12.5% of each plan's week (its 25% less 12.5% given below)",
    "    #signup signup has 12.5% of each plan's week",
    "  Under no share (75% of each plan's week is not allotted)",
  ])
  await graph.apply([
    { entity: { eid: 'funnel' }, attended: null },
    { entity: { eid: 'signup' }, attended: null },
  ])
  equal(await shared(graph, now), [])
  equal((await report(graph, { now })).includes('Shares'), false)
})

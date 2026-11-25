// A wake aimed at a persona knocks its operator each time it fires, committed
// and run as `session_woken` is: the session a person opened wearing it, else
// the project, where the knock waits for the next session at work. One aimed
// at a topic knocks the session opened on it.

import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { effects } from '@yaks/effects'
import { idKeywords } from '@yaks/id'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { taskDoc } from '@yaks/task'
import { toolsDoc } from '@yaks/tools/vocab'
import { personaDoc } from '@yaks/persona/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { goalDoc } from '@yaks/goal'
import { topicDoc } from '@yaks/topic/vocab'
import { tick, wakeDoc, wakeOf } from '@yaks/wake'
import { clock, equal, test } from '@yaks/testing'
import { sessionDoc } from './comp.ts'
import { statusComputed } from './state.ts'
import { running } from './run.ts'
import { awaited } from './woken.ts'

let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  docDoc,
  mailDoc,
  notifyDoc,
  taskDoc,
  sessionDoc,
  toolsDoc,
  personaDoc,
  projectDoc,
  wakeDoc,
  edgeDoc,
  goalDoc,
  topicDoc,
], [kernelKeywords, idKeywords, edgeKeywords])

let MORNING = '0 7 * * * America/Detroit'
let NOTE = 'Morning: plan the day, then write the standup (M-124435).'
let WEIGH = 'Weigh what was filed under the funnel.'
let HOUR = 3_600_000
// 07:00 in Detroit on Nov 7 and 8, 2026 (EST).
let SAT = Date.parse('2026-11-07T12:00:00Z')
let SUN = Date.parse('2026-11-08T12:00:00Z')

// A project, its persona with a morning duty, and the sessions given.
let box = async (...sessions: [string, object][]) => {
  let fx = effects(vocab)
  let g = graph({
    storage: ram(vocab, { computed: statusComputed, number: true }),
    vocab,
    plugins: [fx],
  })
  let { session_woken } = running(g, {
    holder: 'w',
    model: () => Promise.reject(new Error('no turn is taken here')),
    tools: [],
  })
  fx.handle({ session_woken })
  await g.apply([
    { entity: { eid: 'p' }, project: {} },
    { entity: { eid: 'taskmaster' }, persona: { home: 'p' } },
    {
      entity: { eid: 'standup' },
      wake: {
        every: MORNING,
        at: new Date(SAT).toISOString(),
        target: 'taskmaster',
        note: NOTE,
      },
    },
    {
      entity: { eid: 'p-wake' },
      wake: { every: MORNING, at: new Date(SAT).toISOString(), target: 'p' },
    },
    // A goal that is its own topic, with a duty of its own.
    {
      entity: { eid: 'funnel' },
      goal: { scope: 'p' },
      topic: { name: 'funnel' },
    },
    {
      entity: { eid: 'funnel-wake' },
      wake: {
        every: MORNING,
        at: new Date(SAT).toISOString(),
        target: 'funnel',
        note: WEIGH,
      },
    },
    ...sessions.map(([eid, more], i) => ({
      entity: { eid },
      session: { id: eid, persona: 'taskmaster', ...more },
      created: {
        at: new Date(SAT - HOUR * (sessions.length - i)).toISOString(),
      },
    })),
  ], { trusted: true })
  return { g, fx }
}

// Fire what is due at `now`, and the knocks standing after it.
let fire = async ({ g, fx }: Awaited<ReturnType<typeof box>>, now: number) => {
  await tick(g, now)
  await fx.idle()
  return (await g.read('.knock ?doc')).map((b) => ({
    target: (b.knock as { target: string }).target,
    body: (b.doc as { body: string }).body,
  }))
}

// A session opened on the funnel's topic by an agent, so no operator.
let on = { topic: 'funnel', operator: false }

let cases: [string, [string, object][], string][] = [
  [
    'its operator',
    [['operator', { operator: true }], ['worker', {}]],
    'operator',
  ],
  ['its project while no operator can hear', [['gone', {
    operator: true,
    ended: true,
  }]], 'p'],
]
for (let [who, sessions, target] of cases) {
  test(`a persona's morning knocks ${who}`, async () => {
    let b = await box(...sessions)
    equal(await fire(b, SAT), [{
      target,
      body: `Fired on Saturday, November 7, 2026. ${NOTE}`,
    }])
  })
}

// The lines that leave a session's last turn refused by its provider, or
// stopped.
let refused = (s: string): Bundle[] => [
  { entity: { eid: `${s}-ask` }, entry: { session: s, seq: 1 }, ask: {} },
  {
    entity: { eid: `${s}-no` },
    entry: { session: s, seq: 2 },
    refusal: { code: 'busy' },
    output: { source: `${s}-ask` },
  },
]
let halted = (s: string): Bundle[] => [
  { entity: { eid: `${s}-stop` }, entry: { session: s, seq: 1 }, stop: {} },
]

let attended: [string, [string, object][], string[], Bundle[]?][] = [
  ['the session opened on its topic', [['head', on]], ['head']],
  [
    'the one whose last turn failed, which the knock opens again',
    [['head', on], ['asked', on]],
    ['head'],
    refused('head'),
  ],
  [
    'the next one past one that was stopped',
    [['head', on], ['asked', on]],
    ['asked'],
    halted('head'),
  ],
  [
    'the one opened first, of two that can hear',
    [['head', on], ['asked', on]],
    ['head'],
  ],
  [
    'the one that has not ended',
    [['answered', { ...on, ended: true }], ['head', on]],
    ['head'],
  ],
  ['nobody while no session is opened on it', [['worker', {}]], []],
]
for (let [who, sessions, heard, lines = []] of attended) {
  test(`a goal's wake knocks ${who}`, async () => {
    let b = await box(...sessions)
    await b.g.apply(lines, { trusted: true })
    let body = `Fired on Saturday, November 7, 2026. ${WEIGH}`
    equal(
      (await fire(b, SAT)).filter((k) => k.body == body),
      heard.map((target) => ({ target, body })),
    )
  })
}

test('a wake still to fire names the session it reaches as awaited', async () => {
  let { g } = await box(['head', on], ['asked', on], ['worker', {}])
  equal([...await awaited(g)], ['head'])
  await g.apply(refused('head'), { trusted: true })
  equal([...await awaited(g)], ['head'])
  await g.apply([{ entity: { eid: 'funnel-wake' }, wake: { at: null } }], {
    trusted: true,
  })
  equal([...await awaited(g)], [])
})

test('each morning knocks once, however often the clock ticks', async () => {
  let b = await box(['operator', { operator: true }])
  await fire(b, SAT)
  await fire(b, SAT + 60_000)
  equal((await fire(b, SUN)).length, 2)
  equal((await b.g.get(['standup'], ['wake']))[0].wake, {
    every: MORNING,
    at: '2026-11-09T12:00:00.000Z',
    target: 'taskmaster',
    note: NOTE,
  })
})

let standup = await box(['operator', { operator: true }])
let standupNote =
  "Morning: plan the day, then compose and send Jeff's standup. " +
  'On Tuesdays add the retrospective, meta-analysis and weekly update and plan.'
await standup.g.apply([{
  entity: { eid: 'standup' },
  wake: { at: '2026-11-24T12:00:00Z', note: standupNote },
}], { trusted: true })

test('the standup knock dates each firing in Detroit', async () => {
  // A delayed Tuesday firing arrives at 21:00 Detroit time, Wednesday in UTC.
  let time = clock(Date.parse('2026-11-25T02:00:00Z'))
  equal(await fire(standup, time.now()), [{
    target: 'operator',
    body: `Fired on Tuesday, November 24, 2026. ${standupNote}`,
  }])
  await time.advance(10 * HOUR)
  equal((await fire(standup, time.now())).map((k) => k.body).sort(), [
    `Fired on Tuesday, November 24, 2026. ${standupNote}`,
    `Fired on Wednesday, November 25, 2026. ${standupNote}`,
  ])
  let [source] = await standup.g.get(['standup'], ['wake'])
  equal(wakeOf(source)?.note, standupNote)
})

test('a wake that watches a query knocks only for a change, with what changed', async () => {
  let b = await box(['operator', { operator: true }])
  await b.g.apply([{
    entity: { eid: 'standup' },
    watch: { query: '.goal', seen: {} },
  }], { trusted: true })
  let heard = async (now: number) =>
    (await fire(b, now)).filter((k) => k.target == 'operator')
  let [first] = await heard(SAT)
  equal(first.body.split('\n\n').map((p) => p.split('\n')[0]), [
    `Fired on Saturday, November 7, 2026. ${NOTE}`,
    'What changed (1 new):',
  ])
  equal((await heard(SUN)).length, 1)
})

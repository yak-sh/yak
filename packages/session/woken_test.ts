// A wake aimed at a persona knocks its operator each time it fires, committed
// and run as `session_woken` is: the session a person opened wearing it, else
// the project, where the knock waits for the next session at work.

import { graph } from '@yaks/graph'
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
import { tick, wakeDoc } from '@yaks/wake'
import { equal, test } from '@yaks/testing'
import { sessionDoc } from './comp.ts'
import { statusComputed } from './state.ts'
import { running } from './run.ts'

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
], [kernelKeywords, idKeywords])

let MORNING = '0 7 * * * America/Detroit'
let NOTE = 'Morning: plan the day, then write the standup (M-124435).'
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
    ...sessions.map(([eid, more]) => ({
      entity: { eid },
      session: { id: eid, persona: 'taskmaster', ...more },
    })),
  ], { trusted: true })
  return g
}

// Fire what is due at `now`, and the knocks standing after it.
let fire = async (g: Awaited<ReturnType<typeof box>>, now: number) => {
  await tick(g, now)
  await new Promise((r) => setTimeout(r, 0))
  return (await g.read('.knock ?doc')).map((b) => ({
    target: (b.knock as { target: string }).target,
    body: (b.doc as { body: string }).body,
  }))
}

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
    let g = await box(...sessions)
    equal(await fire(g, SAT), [{ target, body: NOTE }])
  })
}

test('each morning knocks once, however often the clock ticks', async () => {
  let g = await box(['operator', { operator: true }])
  await fire(g, SAT)
  await fire(g, SAT + 60_000)
  equal((await fire(g, SUN)).length, 2)
  equal((await g.get(['standup'], ['wake']))[0].wake, {
    every: MORNING,
    at: '2026-11-09T12:00:00.000Z',
    target: 'taskmaster',
    note: NOTE,
  })
})

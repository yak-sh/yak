// Pure transcript fixtures: independent overlap, exact release marks and idle boundaries.
import type { Host } from '@yaks/host'
import type { Step } from '@yaks/session'
import { stepTimingEach } from './step_timing.ts'
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import {
  stepDrift,
  type StepMark,
  type StepTiming,
  stepTimings,
} from './step_timing.ts'

let row = (
  eid: string,
  seq: number,
  at: number,
  parts: Record<string, unknown>,
): Bundle => ({
  entity: { eid },
  entry: { session: 's', seq },
  created: { at: new Date(at).toISOString() },
  ...parts,
})
let mark = (
  eid: string,
  at: number,
  name: string,
  by: string | null,
): StepMark => ({
  at,
  patch: { entity: { eid }, [name]: { by } },
})
let entries = [
  row('a', 1, 0, { ask: { through: 'input' } }),
  row('c1', 2, 30, { call: { source: 'a' } }),
  row('c2', 3, 32, { call: { source: 'a' } }),
  row('r1', 4, 100, { result: { call: 'c1', ms: 40 } }),
  row('r2', 5, 110, { result: { call: 'c2', ms: 60 } }),
  row('p', 6, 115, {
    tool_progress: { call: 'c2' },
    result: { call: 'c2', ms: 1000 },
  }),
  row('out', 7, 116, { output: { source: 'a' } }),
  row('b', 8, 120, { ask: { through: 'r2' } }),
]
let marks = [
  mark('a', 1, 'attempt', 'owner'),
  mark('a', 21, 'attempt', null),
  mark('c1', 40, 'execution', 'owner'),
  mark('c2', 45, 'execution', 'owner'),
  mark('b', 130, 'attempt', 'owner'),
  mark('b', 150, 'attempt', null),
]
let idle = [
  ...entries.slice(0, -1),
  row('input', 7.5, 119, {}),
  entries.at(-1)!,
]
let values = (ms: number[]): StepTiming[] =>
  ms.map((ms, at) => ({ step: String(at), metric: 'tool', ms, at }))
let steady = values([10, 10, 10, 10, 10, 10])
let sustained = values([10, 10, 10, 11, 11, 11])
let spike = values([10, 10, 10, 11, 10, 11])
// Warm pure paths outside the measured cases.
stepTimings(entries, marks)
stepDrift(sustained)

test('native step timing keeps overlapping tools independent and skips progress', () => {
  equal(
    stepTimings(entries, marks).map((
      { step, metric, ms },
    ) => [step, metric, ms]),
    [
      ['a', 'model', 20],
      ['c1', 'dispatch', 10],
      ['c2', 'dispatch', 13],
      ['r1', 'tool', 40],
      ['r2', 'tool', 60],
      ['b', 'preflight', 20],
      ['b', 'model', 20],
    ],
  )
})

test('native preflight ignores output but excludes intervening owner input', () => {
  equal(
    stepTimings(idle, marks, new Set(['input'])).filter((s) =>
      s.metric == 'preflight'
    ),
    [],
  )
  equal(
    stepTimings(entries.slice(-1), marks).filter((s) =>
      s.metric == 'preflight'
    ),
    [],
  )
})

test('native drift needs consecutive same-metric increases with zero slack', () => {
  equal(stepDrift(steady), [])
  equal(stepDrift(spike), [])
  equal(stepDrift(sustained).map((s) => s.step), ['5'])
})

let askedStep: Step = { did: 'asked', status: 'pending', added: [] }
let ranStep: Step = { did: 'ran', status: 'pending', added: [] }
let nothingStep: Step = { did: 'nothing', status: 'settled', added: [] }
let hookOrder: string[] = []
let hookHost = {} as Host
let eachHook = stepTimingEach(hookHost, async (step, session) => {
  await Promise.resolve()
  hookOrder.push(`${session}:${step.did}`)
}, async (session) => {
  await Promise.resolve()
  hookOrder.push(`${session}:collected`)
})
let failure = new Error('collector unavailable')
let failures: unknown[] = []
let failingHook = stepTimingEach(
  {
    report: async (error: unknown) => {
      await Promise.resolve()
      failures.push(error)
    },
  } as Host,
  undefined,
  () => Promise.reject(failure),
)

test('native timing hook awaits asked and ran callbacks and skips nothing collection', async () => {
  hookOrder.length = 0
  await eachHook(askedStep, 's')
  await eachHook(ranStep, 's')
  await eachHook(nothingStep, 's')
  equal(hookOrder, [
    's:asked',
    's:collected',
    's:ran',
    's:collected',
    's:nothing',
  ])
})

test('native timing failure is reported and cannot change a completed tool step', async () => {
  failures.length = 0
  await failingHook(ranStep, 's')
  equal(failures, [failure])
  equal(ranStep, { did: 'ran', status: 'pending', added: [] })
})

// The report is derived from stored task dependencies, not an agent's prose.
const unfinishedReports: unknown[] = []
const unfinishedQueries: string[] = []
let explicitBlock = false
const unfinishedHost = {
  graph: {
    read: (q: string) => {
      unfinishedQueries.push(q)
      return Promise.resolve(
        q.includes('.native')
          ? [{ entity: { eid: 's' }, native: {} }]
          : q.includes('.claim.session')
          ? [{ entity: { eid: 'task' }, doc: { title: 'Unfinished' } }]
          : explicitBlock
          ? [{ entity: { eid: 'dependency' } }]
          : [],
      )
    },
  },
  report: (error: unknown) => {
    unfinishedReports.push(error)
  },
} as unknown as Host

const { unfinishedNativeFinal } = await import('./step_timing.ts')
await unfinishedNativeFinal(unfinishedHost, 's', {
  did: 'asked',
  status: 'settled',
  added: [{ entity: { eid: 'ask' }, ask: {} }],
})
explicitBlock = true
await unfinishedNativeFinal(unfinishedHost, 's', {
  did: 'asked',
  status: 'settled',
  added: [{ entity: { eid: 'ask2' }, ask: {} }],
})
test('settled native work is reported but unfinished dependencies are left waiting', () => {
  equal(unfinishedReports.length, 1)
  equal(unfinishedQueries.some((q) => q.includes('!blocked')), true)
})

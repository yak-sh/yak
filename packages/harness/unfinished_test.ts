// The unfinished-work report is derived from stored task dependencies, never an
// agent's prose, and its hook can neither reorder nor change a step.
import type { Host } from '@yaks/host'
import type { Step } from '@yaks/session'
import { equal, test } from '@yaks/testing'
import { unfinishedEach, unfinishedNativeFinal } from './unfinished.ts'

let settled = (eid: string): Step => ({
  did: 'asked',
  status: 'settled',
  added: [{ entity: { eid }, ask: {} }],
})
let ranStep: Step = { did: 'ran', status: 'pending', added: [] }
let nothingStep: Step = { did: 'nothing', status: 'settled', added: [] }

// A native session holding one claimed task; `blocked` gives that task an
// unfinished dependency, and `native: false` makes the session an outside one.
let fake = (log: unknown[], blocked = false, native = true) =>
  ({
    graph: {
      read: (q: string) => {
        log.push(q.includes('.native') ? 'checked' : q)
        return Promise.resolve(
          q.includes('.native')
            ? native ? [{ entity: { eid: 's' }, native: {} }] : []
            : q.includes('.claim.session')
            ? [{ entity: { eid: 'task' }, doc: { title: 'Unfinished' } }]
            : blocked
            ? [{ entity: { eid: 'dependency' } }]
            : [],
        )
      },
    },
    report: (error: unknown) => {
      log.push((error as Error).message)
    },
  }) as unknown as Host

test('the unfinished hook awaits the step callback first and skips nothing steps', async () => {
  let log: unknown[] = []
  let each = unfinishedEach(fake(log, false, false), async (step, session) => {
    await Promise.resolve()
    log.push(`${session}:${step.did}`)
  })
  await each(settled('ask'), 's')
  await each(nothingStep, 's')
  equal(log, [
    's:asked',
    'checked',
    's:nothing',
  ])
})

test('a failed unfinished check is reported and cannot change a step', async () => {
  let failure = new Error('graph unavailable')
  let failures: unknown[] = []
  let each = unfinishedEach({
    graph: { read: () => Promise.reject(failure) },
    report: (error: unknown) => void failures.push(error),
  } as unknown as Host)
  let step = settled('ask')
  await each(step, 's')
  await each(ranStep, 's')
  equal(failures, [failure])
  equal(step, settled('ask'))
})

test('settled native work is reported but unfinished dependencies are left waiting', async () => {
  let open: unknown[] = []
  let waiting: unknown[] = []
  await unfinishedNativeFinal(fake(open), 's', settled('ask'))
  await unfinishedNativeFinal(fake(waiting, true), 's', settled('ask2'))
  equal(
    open.at(-1),
    'Native session settled with unfinished claimed work: Unfinished',
  )
  equal(waiting.some((l) => String(l).startsWith('Native')), false)
  equal(open.some((q) => String(q).includes('!blocked')), true)
})

// A quiet fixer remains heal's work between tracker reconciliation passes.
const healReports: string[] = []
let healOwns = true
let mutedHeal = false
const healHost = {
  config: { plugins: [{ use: '@yaks/heal', with: { provider: 'openai' } }] },
  graph: {
    get: () =>
      Promise.resolve([{ entity: { eid: 's' }, fixer: { bug: 'bug' } }]),
    read: (q: string) =>
      Promise.resolve(
        q.includes('.native')
          ? [{ entity: { eid: 's' } }]
          : q.includes('.claim.session')
          ? [{ entity: { eid: 'task' }, doc: { title: 'Unfinished' } }]
          : q.includes('.nofix')
          ? mutedHeal ? [{ entity: { eid: 'project' } }] : []
          : q.includes('.about')
          ? healOwns ? [{ entity: { eid: 'ownership' } }] : []
          : [],
      ),
  },
  report: (error: unknown) => {
    healReports.push((error as Error).message)
  },
} as unknown as Host
await unfinishedNativeFinal(healHost, 's', settled('heal-owned'))
const whileOwned = healReports.length
healOwns = false
await unfinishedNativeFinal(healHost, 's', settled('unowned'))
const withoutOwnership = healReports.length
healOwns = true
mutedHeal = true
await unfinishedNativeFinal(healHost, 's', settled('muted'))
test('a heal-owned fixer waits for its follower, while unowned or muted work reports', () => {
  equal(whileOwned, 0)
  equal(withoutOwnership, 1)
  equal(healReports.length, 2)
})

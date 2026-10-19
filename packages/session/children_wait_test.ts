// A queued poll reads a child's place, not its computed session summary. The
// transcript still supplies the result, including a stop overriding the queue.
import { assert, assertEquals } from '@std/assert'
import { clock, test } from '@yaks/testing'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { storage } from '@yaks/sqlite'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { edgeDoc, edgeKeywords } from '@yaks/edge/vocab'
import { taskDoc } from '@yaks/task/vocab'
import { loadVocab } from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc } from '@yaks/model/vocab'
import { stepping } from '../sqlite/testing.ts'
import { sessionDoc } from './comp.ts'
import { childPlace, sessionTools } from './children.ts'
import { dispatchStatus } from './admission.ts'
import { sessionDerived } from './status.ts'

let vocab = loadVocab([kernelDoc, sessionDoc, toolsDoc, modelDoc])
let wait = (g: Graph, child = 'child') =>
  sessionTools(g).find((t) => t.name == 'wait')!.run({
    children: [child],
    timeout: 0,
  }, {
    session: 'parent',
    call: { entity: { eid: 'wait' } },
    entries: [],
  })

for (
  let [name, place, stopped, expected] of [
    ['queued', { dispatch: {} }, false, 'queued'],
    ['admitted', { dispatch: {}, admitted: {} }, false, 'empty'],
    ['waiting', { dispatch: {}, waiting: {} }, false, 'empty'],
    [
      'legacy queue overrides marks',
      {
        dispatch: { state: 'queued' },
        admitted: {},
        waiting: {},
      },
      false,
      'queued',
    ],
    ['stop overrides queue', { dispatch: {} }, true, 'stopped'],
  ] as const
) {
  let computed = 0
  let g = graph({
    vocab,
    storage: ram(vocab, {
      computed: { 'session.status': () => (computed++, 'empty') },
    }),
  })
  await g.apply([
    { entity: { eid: 'parent' }, session: {} },
    ...place
      ? [{
        entity: { eid: 'child' },
        session: {},
        spawned: { parent: 'parent' },
        ...place,
      }]
      : [],
    ...stopped
      ? [{
        entity: { eid: 'last' },
        entry: { session: 'child', seq: 1 },
        stop: {},
      }]
      : [],
  ], { trusted: true })
  test(`child wait preserves ${name}`, async () => {
    computed = 0
    assertEquals(JSON.parse(String(await wait(g))), [{
      session: 'child',
      status: expected,
      output: '',
    }])
    assertEquals(computed, 3)
  })
}

let native = stepping()
let derived = sessionDerived(vocab)
let summaries = 0
let status = derived['session.status']
let store = storage(native.driver, vocab, {
  derived: {
    ...derived,
    'session.status': {
      ...status,
      expr: (owner) => (summaries++, status.expr!(owner)),
      ...status.select
        ? {
          select: (
            ...args: Parameters<NonNullable<typeof status.select>>
          ) => (summaries++, status.select!(...args)),
        }
        : {},
    },
  },
})
store.install()
store.tx((tx) =>
  tx.patch([
    { entity: { eid: 'parent' }, session: {} },
    {
      entity: { eid: 'child' },
      session: {},
      spawned: { parent: 'parent' },
      dispatch: {},
    },
    ...Array.from({ length: 128 }, (_, n): Bundle => ({
      entity: { eid: `other-${n}` },
      session: {},
    })),
  ])
)
let sqlite = graph({ vocab, storage: store })
let pollSteps = 0
let originalGet = sqlite.get
sqlite.get = (ids, comps) => {
  let before = native.steps()
  let rows = originalGet(ids, comps)
  if (ids[0] == 'child') pollSteps = native.steps() - before
  return rows
}
// Compile each read before measuring the case; a fresh store epoch still makes
// the test execute the real SQLite read rather than a memoized bundle.
await childPlace(sqlite, 'child')
store.tx((tx) =>
  tx.patch([{ entity: { eid: 'child' }, session: { id: 'child' } }])
)
test('SQLite child wait does not evaluate an unused session summary', async () => {
  summaries = 0
  assertEquals(dispatchStatus(await childPlace(sqlite, 'child')), 'queued')
  assertEquals(summaries, 0)
  assert(pollSteps > 0 && pollSteps < 100, `poll used ${pollSteps} VM steps`)
})

// A task wait reads nothing while the graph is quiet and, once a write moves
// the store's revision, reads the task's status marks, never its whole row.
let tasked = loadVocab(
  [kernelDoc, edgeDoc, taskDoc, sessionDoc, toolsDoc, modelDoc],
  [kernelKeywords, edgeKeywords],
)
let held = ram(tasked)
let reads = 0, whole = 0, revision = 0
let tg = graph({
  vocab: tasked,
  storage: {
    ...held,
    get: (eids, comps, opts) => (
      reads++, comps || whole++, held.get(eids, comps, opts)
    ),
    read: (query, opts, comps) => (reads++, held.read(query, opts, comps)),
    revision: () => revision,
  },
})
let finish = (eid: string) => {
  held.tx((tx) => tx.patch([{ entity: { eid }, completed: {} }]))
  revision++
}
await tg.apply([
  { entity: { eid: 't' }, task: {} },
  { entity: { eid: 'warm' }, task: {} },
], { trusted: true })
// Time moves only while the wait sleeps: each beat holds the clock until the
// look it wakes is over, the wait asleep again or answered.
let time = clock(), awake = () => {}
let asleep = () => new Promise<void>((on) => awake = on)
let waitOn = sessionTools(tg, {
  clock: {
    now: time.now,
    after: (ms, go) => {
      let cancel = time.after(ms, () => (go(), asleep()))
      awake()
      return cancel
    },
  },
}).find((t) => t.name == 'wait')!
let look = (task: string, timeout: number) =>
  Promise.resolve(waitOn.run({ tasks: [task], timeout }, {
    session: 'parent',
    call: { entity: { eid: 'wait' } },
    entries: [],
  }))
finish('warm')
await look('warm', 0)

test('a task wait reads nothing while the graph is quiet and answers within a second of the task finishing', async () => {
  whole = 0
  let said: unknown, slept = asleep()
  let answer = look('t', 10_000).then((s) => (said = JSON.parse(s), awake()))
  await Promise.race([slept, answer])
  let looked = reads
  await time.advance(5_000)
  assertEquals(reads, looked)
  finish('t')
  await time.advance(1_000)
  assertEquals(said, [{ task: 't', status: 'done', done: true }])
  assertEquals(whole, 0)
})

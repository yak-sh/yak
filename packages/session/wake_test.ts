// A dependency finishing wakes the transcript parked on the task that waits
// on it, whichever runner answers it: a native transcript takes its next turn,
// and a managed one is asked for its next run with an input carrying its
// `using`. A managed run that ends keeps the claim it is parked on, and lets
// it go once nothing is left to wait for.

import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, graph, identityEid } from '@yaks/graph'
import { dead } from '@yaks/graph/bundle'
import { ram } from '@yaks/ram'
import { effectDoc, type Event } from '@yaks/effects'
import { loadVocab } from '@yaks/vocab'
import { edgeDoc, edgeEid, edgeKeywords, link } from '@yaks/edge'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { taskDoc } from '@yaks/task'
import { processDoc } from '@yaks/process'
import { modelDoc } from '@yaks/model'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDoc } from './comp.ts'
import { statusComputed, textOf } from './status.ts'
import { running } from './run.ts'
import { runs } from './tools.ts'
import { rouse, wake } from './wake.ts'
import { transcript } from './react.ts'
import { test } from '@yaks/testing'

let vocab = loadVocab([
  kernelDoc,
  sessionDoc,
  toolsDoc,
  modelDoc,
  effectDoc,
  processDoc,
  edgeDoc,
  taskDoc,
], [kernelKeywords, edgeKeywords])

let P = identityEid('provider', ['fake'])
let CLI = identityEid('provider', ['claude'])
let M = identityEid('model', ['fake-1'])

// A managed run as @yaks/spawn leaves it: asked through a command-line
// provider, its process over with `code`, its provider's stop read in.
let managed = (session: string, code: number): Bundle[] => [
  {
    entity: { eid: CLI },
    provider: { name: 'claude', transport: 'process' },
  },
  { entity: { eid: session }, session: { id: session }, process: { pid: 1 } },
  {
    entity: { eid: `${session}:in` },
    entry: { session },
    content: { body: 'work y' },
    using: { provider: CLI },
  },
  { entity: { eid: 'y' }, claim: { session } },
  ...ending(session, `${session}:end`, `${session}:in`),
  { entity: { eid: session }, exit: { code } },
]

// The line a run's provider ends a turn with: the ask it answered, and stop.
let ending = (session: string, eid: string, through: string): Bundle[] => [{
  entity: { eid },
  entry: { session },
  ask: { through },
  stop: {},
}]

// A run the news asked for, over: its request, and the line that ends it.
let rerun = (n: number): Bundle[] => [
  {
    entity: { eid: `m1:r${n}` },
    entry: { session: 'm1' },
    content: { body: 'again' },
    using: { provider: CLI },
  },
  ...ending('m1', `m1:r${n}:end`, `m1:r${n}`),
]

// Tasks the holder finished itself: news to nobody.
let doneBy = (...tasks: string[]): Bundle[] =>
  tasks.map((eid) => ({ entity: { eid }, completed: { by: 'm1' } }))

let memory = () => ram(vocab, { computed: statusComputed })

// One graph in memory holding a fixture's rows, and the handlers a host lends
// the commit's effects: called with the event the fixture's last commit would
// raise, since the pool that raises them is not what is under test.
let world = (rows: Bundle[]) => {
  let storage = memory()
  storage.tx((tx) => {
    tx.patch(rows.filter((b) => !dead(b)))
    tx.remove(rows.filter(dead).map((b) => b.entity))
  })
  let g = graph({ storage, vocab })
  let h = running(g, {
    holder: 'w1',
    model: () => Promise.reject(new Error('no turn is taken here')),
    tools: [],
  })
  let fire = (name: string, kind: Event['kind'], e: Partial<Event>) =>
    h[name](
      { kind, name: '', ...e } as Event,
      g.outside,
      (b) => g.apply(b, { trusted: true }),
    )
  return {
    g,
    // a task finished: the commit's `session_wake`
    finish: (task: string) =>
      fire('session_wake', 'changed', { entity: { eid: task } }),
    // a dependency link, or a dependency with it, went away: read as the
    // commit found it
    drop: (eid: string, edge: Comp) =>
      fire('session_wake', 'removed', {
        entity: { eid },
        before: { entity: { eid }, edge },
      }),
    // a terminal entry landed: the commit's `session_release`
    release: (entry: string) =>
      fire('session_release', 'created', { entity: { eid: entry } }),
    claim: async (task: string) =>
      ((await g.get([task]))[0].claim as Comp | undefined)?.session,
  }
}

// What a test starts from, `y` waiting on `x` and `z`: applied through the
// graph a batch at a time, and the rows each left laid into a world of the
// test's own, all as the module loads.
let image = async (
  ...batches: Bundle[][]
): Promise<ReturnType<typeof world>> => {
  let g = graph({ storage: memory(), vocab })
  let rows = await g.apply([
    { entity: { eid: 'x' }, task: {} },
    { entity: { eid: 'y' }, task: {} },
    { entity: { eid: 'z' }, task: {} },
    link('y', 'requires', 'x'),
    link('y', 'contains', 'z'),
  ], { trusted: true })
  for (let b of batches) rows.push(...await g.apply(b, { trusted: true }))
  return world(rows)
}

// A dependency somebody else finished, after the claim on `y` was taken; or
// one deleted, or the link to it.
let finished = (task: string): Bundle[] => [
  { entity: { eid: task }, completed: {} },
]
let deleted = (eid: string): Bundle[] => [{ entity: { eid }, $delete: true }]
let REQUIRES = edgeEid('y', 'requires', 'x')
let CONTAINS = edgeEid('y', 'contains', 'z')

// A native transcript holding `y`, its turn returned, and `x` finished; and
// the same once that woke it.
let native = [
  { entity: { eid: P }, provider: { name: 'fake' } },
  { entity: { eid: M }, model: { name: 'fake-1' } },
  { entity: { eid: 's1' }, session: { id: 's1' } },
  {
    entity: { eid: 's1:in' },
    entry: { session: 's1' },
    content: { body: 'work y' },
    using: { provider: P, model: M },
  },
  {
    entity: { eid: 's1:out' },
    entry: { session: 's1' },
    content: { body: 'done' },
    ask: { through: 's1:in' },
    output: {},
  },
  { entity: { eid: 'y' }, claim: { session: 's1' } },
]
let NATIVE = await image(native, finished('x'))
let TOLD = await image(native, finished('x'))
await TOLD.finish('x')
// A managed run holding `y`: ended, with `x` since finished, deleted or its
// link gone, or with `y` cancelled; failed; woken for `x`, its next run over
// with `z` open, done too, or since finished; or having finished `z` itself
// before its link went.
let PARKED = await image(managed('m1', 0))
let PARKED_X = await image(managed('m1', 0), finished('x'))
let X_GONE = await image(managed('m1', 0), deleted('x'))
let LINK_GONE = await image(managed('m1', 0), deleted(REQUIRES))
let CANCELLED = await image(managed('m1', 0), [
  { entity: { eid: 'y' }, cancelled: {} },
])
let FAILED = await image(managed('m1', 3))
let WOKEN = await image([...managed('m1', 0), ...doneBy('x'), ...rerun(2)])
let WOKEN_Z = await image(
  [...managed('m1', 0), ...doneBy('x'), ...rerun(2)],
  finished('z'),
)
let DONE = await image([...managed('m1', 0), ...doneBy('x', 'z'), ...rerun(2)])
let OWN = await image([...managed('m1', 0), ...doneBy('z')], deleted(CONTAINS))
// A managed run still going, holding `y` and `x`.
let GOING = await image([
  ...managed('m1', 0).slice(0, 4),
  { entity: { eid: 'x' }, claim: { session: 'm1' } },
])

// A release run once on a world of its own, so the first case to release
// times its release, not the handler's first run in this runtime.
await (await image(managed('m1', 0))).release('m1:end')

// What a transcript was last told, and how many entries it holds.
let newest = async (g: ReturnType<typeof graph>, session: string) =>
  (await g.read(`.entry.session=${session}&.order=-entry.seq&.limit=1&*`))[0]
let count = async (g: ReturnType<typeof graph>, session: string) =>
  (await g.read(`.entry.session=${session}&.fields=entity.eid`)).length

let last = async (w: ReturnType<typeof world>) =>
  textOf(await newest(w.g, 'm1'))

test('a managed run that ends waiting on a dependency is parked', async () => {
  let w = PARKED
  await w.release('m1:end')
  assertEquals(await w.claim('y'), 'm1')
})

test('a native transcript parked on a task takes a turn when a dependency finishes', async () => {
  await NATIVE.finish('x')
  let turn = await newest(NATIVE.g, 's1')
  // The turn asked for carries the `using` in force, and says which finished.
  assertEquals((turn.using as Comp).provider, P)
  assert(textOf(turn).includes('#x'), textOf(turn))
})

test('a native transcript told of a finished dependency is not told again', async () => {
  let before = await count(TOLD.g, 's1')
  await rouse(TOLD.g, 's1')
  assertEquals(await count(TOLD.g, 's1'), before)
})

test('a managed run parked on a task is woken when a dependency finishes', async () => {
  let w = PARKED_X
  await w.finish('x')
  let wake = await newest(w.g, 'm1')
  assertEquals((wake.using as Comp).provider, CLI)
  assert(textOf(wake).includes('#x'))
})

test('a woken run that ends still waiting on a dependency keeps its claim', async () => {
  let w = WOKEN
  await w.release('m1:r2:end')
  assertEquals(await w.claim('y'), 'm1')
})

test('a dependency that finishes after a wake is told on its own', async () => {
  let w = WOKEN_Z
  await w.finish('z')
  let said = await last(w)
  assert(said.includes('#z') && !said.includes('#x'), said)
})

test('the last run ends with nothing left to wait on, and lets go', async () => {
  let w = DONE
  await w.release('m1:r2:end')
  assertEquals(await w.claim('y'), undefined)
})

test('a dependency link going away after the dependency finished tells nothing', async () => {
  let w = OWN
  let told = await count(w.g, 'm1')
  await w.drop(CONTAINS, { from: 'y', to: 'z' })
  assertEquals(await count(w.g, 'm1'), told)
})

test('a managed run parked on a task is woken when a dependency link goes away', async () => {
  let w = LINK_GONE
  await w.drop(REQUIRES, { from: 'y', to: 'x' })
  let wake = await newest(w.g, 'm1')
  assertEquals((wake.using as Comp).provider, CLI)
  assert(textOf(wake).includes('no longer waits on #x'), textOf(wake))
})

test('a managed run parked on a task is woken when a dependency it waits on is deleted', async () => {
  let w = X_GONE
  assertEquals(await w.claim('y'), 'm1')
  // The link went with x: only what the commit found says which ends it had.
  await w.drop('x', { from: 'y', to: 'x' })
  let wake = await newest(w.g, 'm1')
  assertEquals((wake.using as Comp).provider, CLI)
  assert(textOf(wake).includes('no longer waits on #x'), textOf(wake))
})

test('a managed run that failed lets go of the task it was waiting on', async () => {
  let w = FAILED
  await w.release('m1:end')
  assertEquals(await w.claim('y'), undefined)
})

test('a parked task finished by somebody else lets its claim go', async () => {
  let w = CANCELLED
  await w.release('y')
  assertEquals(await w.claim('y'), undefined)
})

test('a managed run wrapping up keeps the task it is parked on', async () => {
  let w = GOING
  let said = await runs({ vocab }).session_wrap!(
    { entity: { eid: 'c1' }, call: { args: { session: 'm1' } } },
    w.g,
  ) as Bundle[]
  assertEquals(said.slice(1).map((b) => [b.entity.eid, b.claim]), [
    ['x', null],
  ])
})

// The README's dependency-wake example: fixture construction lives here, so
// its budget measures waking and reading the transcript, not loading vocab.
let exampleRows: Bundle[] = [
  { entity: { eid: CLI }, provider: { name: 'claude' } },
  { entity: { eid: 'x' }, task: {}, completed: {} },
  { entity: { eid: 'y' }, task: {}, claim: { session: 's' } },
  link('y', 'requires', 'x'),
  { entity: { eid: 's' }, session: {} },
  {
    entity: { eid: 's:in' },
    entry: { session: 's' },
    content: { body: 'work y' },
    using: { provider: CLI },
  },
  {
    entity: { eid: 's:out' },
    entry: { session: 's' },
    content: { body: 'waiting on x' },
    output: {},
  },
]

// Each module load owns a fresh graph; neither delivery nor its answer is
// precomputed. The runner's second load gets another parked transcript.
let exampleStorage = memory()
exampleStorage.tx((tx) => tx.patch(exampleRows))
let exampleGraph = graph({ storage: exampleStorage, vocab })

test('a dependency wake carries completion news and the parked provider choice', async () => {
  let g = exampleGraph
  await wake(g, 'x')
  let told = (await transcript(g, 's')).at(-1)!
  assertEquals(told.content, {
    body:
      '#x (done), which #y waits on, has finished; nothing it waits on is open.',
  })
  assertEquals(told.using, { provider: CLI })
})

// A dependency finishing wakes the transcript parked on the task that waits
// on it, whichever runner answers it: a native transcript takes its next turn,
// and a managed one is asked for its next run with an input carrying its
// `using`. A managed run that ends keeps the claim it is parked on, and lets
// it go once nothing is left to wait for.

import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, graph, identityEid } from '@yaks/graph'
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
import { rouse } from './wake.ts'
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

// One graph in memory, `y` waiting on `x` and `z`, and the handlers a host
// lends the commit's effects: called with the event a commit would raise, since
// the pool that raises them is not what is under test.
let world = async (...setup: Bundle[][]) => {
  let g = graph({
    storage: ram(vocab, { computed: statusComputed }),
    vocab,
  })
  let h = running(g, {
    holder: 'w1',
    model: () => Promise.reject(new Error('no turn is taken here')),
    tools: [],
  })
  await g.apply([
    { entity: { eid: 'x' }, task: {} },
    { entity: { eid: 'y' }, task: {} },
    { entity: { eid: 'z' }, task: {} },
    link('y', 'requires', 'x'),
    link('y', 'contains', 'z'),
    ...setup.flat(),
  ], { trusted: true })
  let fire = (name: string, kind: Event['kind'], e: Partial<Event>) =>
    h[name](
      { kind, name: '', ...e } as Event,
      undefined!,
      undefined!,
      undefined!,
    )
  return {
    g,
    // a task finished: the commit's `session_wake`
    finish: async (task: string) => {
      await g.apply([{ entity: { eid: task }, completed: {} }])
      await fire('session_wake', 'changed', { entity: { eid: task } })
    },
    // a dependency link, or a dependency with it, went away
    drop: async (eid: string, edge?: Comp) => {
      await g.apply([{ entity: { eid }, $delete: true }])
      await fire('session_wake', 'removed', {
        entity: { eid },
        before: edge && { entity: { eid }, edge },
      })
    },
    // a terminal entry landed: the commit's `session_release`
    release: (entry: string) =>
      fire('session_release', 'created', { entity: { eid: entry } }),
    claim: async (task: string) =>
      ((await g.get([task]))[0].claim as Comp | undefined)?.session,
  }
}

// What a transcript was last told, and how many entries it holds.
let newest = async (g: ReturnType<typeof graph>, session: string) =>
  (await g.read(`.entry.session=${session}&.order=-entry.seq&.limit=1&*`))[0]
let count = async (g: ReturnType<typeof graph>, session: string) =>
  (await g.read(`.entry.session=${session}&.fields=entity.eid`)).length

test('a native transcript parked on a task takes a turn when a dependency finishes', async () => {
  let w = await world([
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
  ])
  await w.finish('x')
  let [turn] = [await newest(w.g, 's1')]
  // The turn asked for carries the `using` in force, and says which finished.
  assertEquals((turn.using as Comp).provider, P)
  assert(textOf(turn).includes('#x'), textOf(turn))
  // Told once: rousing it again says nothing new.
  let before = await count(w.g, 's1')
  await rouse(w.g, 's1')
  assertEquals(await count(w.g, 's1'), before)
})

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

let last = async (w: Awaited<ReturnType<typeof world>>) =>
  textOf(await newest(w.g, 'm1'))

test('a managed run that ends waiting on a dependency is parked', async () => {
  let w = await world(managed('m1', 0))
  await w.release('m1:end')
  assertEquals(await w.claim('y'), 'm1')
})

test('a managed run parked on a task is woken when a dependency finishes', async () => {
  let w = await world(managed('m1', 0))
  await w.finish('x')
  let [wake] = [await newest(w.g, 'm1')]
  assertEquals((wake.using as Comp).provider, CLI)
  assert(textOf(wake).includes('#x'))
})

test('a woken run that ends still waiting on a dependency keeps its claim', async () => {
  let w = await world(managed('m1', 0), doneBy('x'), rerun(2))
  await w.release('m1:r2:end')
  assertEquals(await w.claim('y'), 'm1')
})

test('a dependency that finishes after a wake is told on its own', async () => {
  let w = await world(managed('m1', 0), doneBy('x'), rerun(2))
  await w.finish('z')
  let said = await last(w)
  assert(said.includes('#z') && !said.includes('#x'), said)
})

test('the last run ends with nothing left to wait on, and lets go', async () => {
  let w = await world(managed('m1', 0), doneBy('x', 'z'), rerun(2))
  await w.release('m1:r2:end')
  assertEquals(await w.claim('y'), undefined)
})

test('a dependency link going away after the dependency finished tells nothing', async () => {
  let w = await world(managed('m1', 0), doneBy('z'))
  let told = await count(w.g, 'm1')
  await w.drop(edgeEid('y', 'contains', 'z'), { from: 'y', to: 'z' })
  assertEquals(await count(w.g, 'm1'), told)
})

test('a managed run parked on a task is woken when a dependency link goes away', async () => {
  let w = await world(managed('m1', 0))
  await w.drop(edgeEid('y', 'requires', 'x'), { from: 'y', to: 'x' })
  let [wake] = [await newest(w.g, 'm1')]
  assertEquals((wake.using as Comp).provider, CLI)
  assert(textOf(wake).includes('no longer waits on #x'), textOf(wake))
})

test('a managed run parked on a task is woken when a dependency it waits on is deleted', async () => {
  let w = await world(managed('m1', 0))
  assertEquals(await w.claim('y'), 'm1')
  // The link goes with x: only what the commit found says which ends it had.
  await w.drop('x', { from: 'y', to: 'x' })
  let [wake] = [await newest(w.g, 'm1')]
  assertEquals((wake.using as Comp).provider, CLI)
  assert(textOf(wake).includes('no longer waits on #x'), textOf(wake))
})

test('a managed run that failed lets go of the task it was waiting on', async () => {
  let w = await world(managed('m1', 3))
  await w.release('m1:end')
  assertEquals(await w.claim('y'), undefined)
})

test('a parked task finished by somebody else lets its claim go', async () => {
  let w = await world(managed('m1', 0))
  await w.g.apply([{ entity: { eid: 'y' }, cancelled: {} }])
  await w.release('y')
  assertEquals(await w.claim('y'), undefined)
})

test('a managed run wrapping up keeps the task it is parked on', async () => {
  let w = await world([
    ...managed('m1', 0).slice(0, 4),
    { entity: { eid: 'x' }, claim: { session: 'm1' } },
  ])
  let said = await runs({ vocab }).session_wrap!(
    { entity: { eid: 'c1' }, call: { args: { session: 'm1' } } },
    w.g,
  ) as Bundle[]
  assertEquals(said.slice(1).map((b) => [b.entity.eid, b.claim]), [
    ['x', null],
  ])
})

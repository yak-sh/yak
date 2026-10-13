// A dependency finishing wakes the transcript parked on the task that waits
// on it, whichever runner answers it: a native transcript takes its next turn,
// and a managed one is asked for its next run with an input carrying its
// `using`. A managed run that ends keeps the claim it is parked on, and lets
// it go once nothing is left to wait for.

import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, graph, identityEid } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/testing.ts'
import { effectDoc, effects } from '@yaks/effects'
import { loadVocab } from '@yaks/vocab'
import { edgeDoc, edgeEid, edgeKeywords, edges, link } from '@yaks/edge'
import { kernel, kernelDoc, kernelKeywords } from '@yaks/kernel'
import { taskDoc, tasks } from '@yaks/task'
import { processDoc } from '@yaks/process'
import { type Model, modelDoc } from '@yaks/model'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'
import { transcript } from './react.ts'
import { sessionDerived, textOf } from './status.ts'
import { answers } from './providers.ts'
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
  { $defs: { worker: { component: true, type: 'object', properties: {} } } },
], [kernelKeywords, edgeKeywords])

let P = identityEid('provider', ['fake'])
let CLI = identityEid('provider', ['claude'])
let M = identityEid('model', ['fake-1'])

// One worker over a fresh store: the runner lent a model that answers `done`
// and counts what it was asked, `y` waiting on `x` and `z`.
let world = async () => {
  let s = storage(mem(), vocab, { derived: sessionDerived(vocab) })
  s.install()
  let asked: string[] = []
  let model: Model = (req) => {
    asked.push(JSON.stringify(req.items))
    return Promise.resolve({
      id: `r${asked.length}`,
      model: req.model,
      items: [{ kind: 'assistant', text: 'done' }],
    })
  }
  let fx = effects(vocab, {
    owner: 'w1',
    write: (b) => g.apply(b, { trusted: true }),
  })
  let g = graph({
    storage: s,
    vocab,
    plugins: [kernel(), edges(vocab), tasks(), sessions(), fx],
  })
  fx.handle(running(g, {
    holder: 'w1',
    model,
    tools: [],
    answers: answers(g, {}, model),
  }))
  await g.apply([
    { entity: { eid: 'w1' }, worker: {} },
    { entity: { eid: P }, provider: { name: 'fake' } },
    {
      entity: { eid: CLI },
      provider: { name: 'claude', transport: 'process' },
    },
    { entity: { eid: M }, model: { name: 'fake-1' } },
    { entity: { eid: 'x' }, task: {} },
    { entity: { eid: 'y' }, task: {} },
    { entity: { eid: 'z' }, task: {} },
    link('y', 'requires', 'x'),
    link('y', 'contains', 'z'),
  ], { trusted: true })
  await fx.work(g)
  let idle = () => fx.idle()
  let claim = async (task: string) =>
    ((await g.get([task]))[0].claim as Comp | undefined)?.session
  return { g, asked, idle, claim }
}

let entries = async (g: ReturnType<typeof graph>, session: string) =>
  (await transcript(g, session)).map(textOf)

test('a native transcript parked on a task takes a turn when a dependency finishes', async () => {
  let w = await world()
  await w.g.apply([
    { entity: { eid: 's1' }, session: { id: 's1' } },
    {
      entity: { eid: 's1:in' },
      entry: { session: 's1' },
      content: { body: 'work y' },
      using: { provider: P, model: M },
    },
    { entity: { eid: 'y' }, claim: { session: 's1' } },
  ])
  await w.idle()
  assertEquals(w.asked.length, 1)
  await w.g.apply([{ entity: { eid: 'x' }, completed: {} }])
  await w.idle()
  assertEquals(w.asked.length, 2)
  // The turn is told which dependency finished.
  assert(w.asked[1].includes('#x'), w.asked[1])
  // Told once: rousing it again says nothing new.
  let before = (await entries(w.g, 's1')).length
  await rouse(w.g, 's1')
  await w.idle()
  assertEquals((await entries(w.g, 's1')).length, before)
})

// A managed run as @yaks/spawn leaves it: asked through a command-line
// provider, its process over with `code`, its provider's stop read in.
let managed = (session: string, code: number): Bundle[] => [
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

test('a managed run that ends waiting on a dependency is parked, and woken by it', async () => {
  let w = await world()
  await w.g.apply(managed('m1', 0))
  await w.idle()
  assertEquals(await w.claim('y'), 'm1')
  await w.g.apply([{ entity: { eid: 'x' }, completed: {} }])
  await w.idle()
  let [wake] = (await transcript(w.g, 'm1')).slice(-1)
  assertEquals((wake.using as Comp).provider, CLI)
  assert(textOf(wake).includes('#x'))
  // The run it asks for ends, still waiting on z, and keeps the claim.
  let end = async (eid: string) => {
    let asked = (await transcript(w.g, 'm1')).filter((b) => b.using).at(-1)!
    await w.g.apply(ending('m1', eid, asked.entity.eid))
    await w.idle()
  }
  await end('m1:second')
  assertEquals(await w.claim('y'), 'm1')
  await w.g.apply([{ entity: { eid: 'z' }, completed: {} }])
  await w.idle()
  assert(textOf((await transcript(w.g, 'm1')).at(-1)!).includes('#z'))
  // The last run ends with nothing left to wait on, and lets go.
  await end('m1:third')
  assertEquals(await w.claim('y'), undefined)
})

test('a managed run parked on a task is woken when a dependency link goes away', async () => {
  let w = await world()
  await w.g.apply(managed('m1', 0))
  await w.idle()
  let said = async () => textOf((await transcript(w.g, 'm1')).at(-1)!)
  // z is done before its link goes: nothing new to tell.
  await w.g.apply([{ entity: { eid: 'z' }, completed: {} }])
  await w.idle()
  let told = await said()
  await w.g.apply([{
    entity: { eid: edgeEid('y', 'contains', 'z') },
    $delete: true,
  }])
  await w.idle()
  assertEquals(await said(), told)
  // x is still open when y stops waiting on it.
  let asked = (await transcript(w.g, 'm1')).filter((b) => b.using).at(-1)!
  await w.g.apply(ending('m1', 'm1:second', asked.entity.eid))
  await w.idle()
  assertEquals(await w.claim('y'), 'm1')
  await w.g.apply([{
    entity: { eid: edgeEid('y', 'requires', 'x') },
    $delete: true,
  }])
  await w.idle()
  let [wake] = (await transcript(w.g, 'm1')).slice(-1)
  assertEquals((wake.using as Comp).provider, CLI)
  assert(textOf(wake).includes('no longer waits on #x'), textOf(wake))
})

test('a managed run that failed lets go of the task it was waiting on', async () => {
  let w = await world()
  await w.g.apply(managed('m1', 3))
  await w.idle()
  assertEquals(await w.claim('y'), undefined)
})

test('a parked task finished by somebody else lets its claim go', async () => {
  let w = await world()
  await w.g.apply(managed('m1', 0))
  await w.idle()
  await w.g.apply([{ entity: { eid: 'y' }, cancelled: {} }])
  await w.idle()
  assertEquals(await w.claim('y'), undefined)
})

test('a managed run wrapping up keeps the task it is parked on', async () => {
  let w = await world()
  await w.g.apply([
    ...managed('m1', 0).slice(0, 3),
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

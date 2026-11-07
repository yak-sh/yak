// A dependency finishing wakes the transcript parked on the task that waits
// on it, whichever runner answers it: a native transcript takes its next turn,
// and a managed one is asked for its next run with an input carrying its
// `using`. A managed run that ends keeps the claim it is parked on, and lets
// it go once nothing is left to wait for.

import { assert, assertEquals, assertRejects } from '@std/assert'
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
import { notifyDoc } from '@yaks/notify/vocab'
import { personaDoc } from '@yaks/persona/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { sessions } from './plugin.ts'
import { sessionDoc } from './comp.ts'
import { statusComputed, textOf } from './status.ts'
import { running, settle } from './run.ts'
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
  notifyDoc,
  personaDoc,
  projectDoc,
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
  let g = graph({ storage, vocab, plugins: [sessions()] })
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
    abandon: (task: string) =>
      fire('session_wake', 'removed', {
        entity: { eid: task },
        before: { entity: { eid: task }, claim: { session: 'worker' } },
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
  let g = graph({ storage: memory(), vocab, plugins: [sessions()] })
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
    attempt: { by: null },
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
// A run still going, its process listed, holding `y` and `z` as `y` is done
// or cancelled.
let going = (mark: string) =>
  image(managed('m1', 0).slice(0, 4), [
    { entity: { eid: 'z' }, claim: { session: 'm1' } },
  ], [{ entity: { eid: 'y' }, [mark]: {} }])
let CLOSED = [await going('completed'), await going('cancelled')]
let WOKEN = await image([...managed('m1', 0), ...doneBy('x'), ...rerun(2)])
let WOKEN_Z = await image(
  [...managed('m1', 0), ...doneBy('x'), ...rerun(2)],
  finished('z'),
)
let DONE = await image([...managed('m1', 0), ...doneBy('x', 'z'), ...rerun(2)])
let OWN = await image(
  [...managed('m1', 0), ...doneBy('z')],
  deleted(CONTAINS),
  [
    { entity: { eid: 'x' }, blocked: { on: 'vendor' } },
  ],
)
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

let OUTSIDE: Bundle[] = [{ entity: { eid: 'z' }, blocked: { on: 'vendor' } }]
let UNATTENDED = await image(managed('m1', 0), OUTSIDE)
let SELF = await image(managed('m1', 0), OUTSIDE, [
  { entity: { eid: 'x' }, claim: { session: 'm1' } },
])
let WORKER: Bundle[] = [
  { entity: { eid: 'worker' }, session: {}, process: { pid: 2 } },
  { entity: { eid: 'worker:end' }, entry: { session: 'worker' }, stop: {} },
  { entity: { eid: 'x' }, claim: { session: 'worker' } },
]
let ATTENDED = await image(managed('m1', 0), OUTSIDE, WORKER)
let ABANDONED = await image(managed('m1', 0), OUTSIDE, WORKER, [
  { entity: { eid: 'worker' }, exit: { code: 1 } },
])
let RELEASED = await image(managed('m1', 0), OUTSIDE, WORKER, [
  { entity: { eid: 'x' }, claim: null },
])
let NESTED = await image(managed('m1', 0), OUTSIDE, [
  { entity: { eid: 'leaf' }, task: {} },
  link('x', 'requires', 'leaf'),
  { entity: { eid: 'x' }, claim: { session: 'm1' } },
])
let EXTERNAL = await image(managed('m1', 0), OUTSIDE, [{
  entity: { eid: 'x' },
  decision: {
    question: 'Which?',
    choices: [{ label: 'a', description: 'a' }, {
      label: 'b',
      description: 'b',
    }],
  },
}])
let CYCLE = await image(managed('m1', 0), OUTSIDE, [
  link('x', 'requires', 'y'),
  { entity: { eid: 'parent' }, session: {} },
  { entity: { eid: 'm1' }, spawned: { parent: 'parent' } },
])
let NATIVE_WORK = await image(native, OUTSIDE, [
  { entity: { eid: 'worker' }, session: {} },
])
let WRAPPING = await image(managed('m1', 0), OUTSIDE, WORKER, [
  { entity: { eid: 'worker' }, session: { ended: true } },
])
let HUMAN = await image(managed('m1', 0), OUTSIDE, [
  { entity: { eid: 'human' }, person: {} },
  { entity: { eid: 'x' }, filed: { assignee: 'human' } },
])
// A Claude Code subagent holding `y`, read from its file into its parent's
// process: it rests on its prose, and runs no request of ours.
let SUBAGENT = await image(OUTSIDE, finished('x'), [
  { entity: { eid: 'parent' }, session: {} },
  { entity: { eid: 'sub.jsonl' }, transcript: { session: 'sub' } },
  {
    entity: { eid: 'sub' },
    session: { id: 'sub', transcript: 'sub.jsonl' },
    spawned: { parent: 'parent' },
  },
  ...[
    { content: { body: 'work y' } },
    { ask: { to: M } },
    { content: { body: 'working' }, output: { source: 'sub:2' } },
  ].map((b, i) => ({
    entity: { eid: `sub:${i + 1}` },
    entry: { session: 'sub', seq: i + 1 },
    ...b,
  })),
  { entity: { eid: 'y' }, claim: { session: 'sub' } },
])
let NO_PROVIDER = await image(managed('m1', 0), OUTSIDE, [
  { entity: { eid: 'parent' }, session: {} },
  { entity: { eid: 'm1' }, spawned: { parent: 'parent' } },
  { entity: { eid: 'm1:in' }, using: null },
])
let LEAF_GONE = await image(managed('m1', 0), OUTSIDE, [
  { entity: { eid: 'leaf' }, task: {} },
  link('x', 'requires', 'leaf'),
], deleted(edgeEid('x', 'requires', 'leaf')))
let RESTING_WORKER = await image(managed('m1', 0), OUTSIDE, [
  ...managed('worker', 0).filter((b) => b.entity.eid != 'y'),
  { entity: { eid: 'x' }, claim: { session: 'worker' } },
])
let CONTENDED = await image(managed('m1', 0), OUTSIDE, [
  ...managed('m2', 0).filter((b) => b.entity.eid != 'y'),
  { entity: { eid: 'r' }, task: {}, claim: { session: 'm2' } },
  link('r', 'requires', 'x'),
])

test('an unattended dependency is claimed and given to the waiting run on its provider', async () => {
  await rouse(UNATTENDED.g, 'm1')
  assertEquals(await UNATTENDED.claim('x'), 'm1')
  let input = await newest(UNATTENDED.g, 'm1')
  assertEquals(input.using, { provider: CLI })
  assert(textOf(input).includes('#x'))
  let before = await count(UNATTENDED.g, 'm1')
  await rouse(UNATTENDED.g, 'm1')
  assertEquals(await count(UNATTENDED.g, 'm1'), before)
})

test('a run resumes work it already holds instead of waiting on itself', async () => {
  let before = await count(SELF.g, 'm1')
  await rouse(SELF.g, 'm1')
  assertEquals(await SELF.claim('x'), 'm1')
  assertEquals(await count(SELF.g, 'm1'), before + 1)
})

test('a dependency with a running worker stays with that worker', async () => {
  let before = await count(ATTENDED.g, 'm1')
  await rouse(ATTENDED.g, 'm1')
  assertEquals(await ATTENDED.claim('x'), 'worker')
  assertEquals(await count(ATTENDED.g, 'm1'), before)
})

test('a resting dependency holder resumes its own work without a second writer', async () => {
  await rouse(RESTING_WORKER.g, 'm1')
  assertEquals(await RESTING_WORKER.claim('x'), 'worker')
  let input = await newest(RESTING_WORKER.g, 'worker')
  assertEquals(input.using, { provider: CLI })
  assert(textOf(input).includes('#x'))
  let before = await count(RESTING_WORKER.g, 'worker')
  await rouse(RESTING_WORKER.g, 'm1')
  assertEquals(await count(RESTING_WORKER.g, 'worker'), before)
})

test('two waiting runs give an unattended dependency to one worker', async () => {
  await Promise.all([rouse(CONTENDED.g, 'm1'), rouse(CONTENDED.g, 'm2')])
  let holder = await CONTENDED.claim('x')
  assert(holder == 'm1' || holder == 'm2')
  let inputs = await CONTENDED.g.read('.woken&.fields=entry.session')
  assertEquals(inputs.length, 1)
  assertEquals((inputs[0].entry as Comp).session, holder)
})

test('a failed worker does not strand the run waiting on its task', async () => {
  await rouse(ABANDONED.g, 'm1')
  assertEquals(
    (await ABANDONED.g.read('.effect.handler=session_release')).length,
    1,
  )
  await ABANDONED.release('x')
  await ABANDONED.abandon('x')
  assertEquals(await ABANDONED.claim('x'), 'm1')
})

test('wrapping does not take work from a managed process that still runs', async () => {
  let before = await count(WRAPPING.g, 'm1')
  await rouse(WRAPPING.g, 'm1')
  assertEquals(await WRAPPING.claim('x'), 'worker')
  assertEquals(await count(WRAPPING.g, 'm1'), before)
})

test('a task assigned to a person remains in that person’s queue', async () => {
  let before = await count(HUMAN.g, 'm1')
  await rouse(HUMAN.g, 'm1')
  assertEquals(await HUMAN.claim('x'), undefined)
  assertEquals(await count(HUMAN.g, 'm1'), before)
})

test('removing a nested dependency resumes the ancestor’s newly runnable task', async () => {
  await LEAF_GONE.drop(edgeEid('x', 'requires', 'leaf'), {
    from: 'x',
    to: 'leaf',
  })
  assertEquals(await LEAF_GONE.claim('x'), 'm1')
})

test('a subagent its harness runs is passed over, its parent told nothing', async () => {
  let before = await count(SUBAGENT.g, 'sub')
  await SUBAGENT.finish('x')
  await rouse(SUBAGENT.g, 'sub')
  assertEquals(await count(SUBAGENT.g, 'sub'), before)
  assertEquals(await SUBAGENT.g.read('.knock.target=parent'), [])
})

test('a run without a provider reports its impossible wait to its parent before failing', async () => {
  await assertRejects(() => rouse(NO_PROVIDER.g, 'm1'), Error, 'no provider')
  let [notice] = await NO_PROVIDER.g.read('.knock.target=parent&?content')
  assert(String((notice.content as Comp).body).includes('no provider'))
})

test('losing a worker wakes a parked dependent through the claim removal effect', async () => {
  await RELEASED.abandon('x')
  assertEquals(await RELEASED.claim('x'), 'm1')
})

test('a dependency chain resumes its runnable leaf', async () => {
  await rouse(NESTED.g, 'm1')
  assertEquals(await NESTED.claim('leaf'), 'm1')
  assert((await last(NESTED)).includes('#leaf'))
})

test('decisions and explicit outside blockers keep their external wait', async () => {
  let before = await count(EXTERNAL.g, 'm1')
  await rouse(EXTERNAL.g, 'm1')
  assertEquals(await EXTERNAL.claim('x'), undefined)
  assertEquals(await count(EXTERNAL.g, 'm1'), before)
})

test('an impossible dependency wakes its run and immediately notifies the spawning session', async () => {
  await rouse(CYCLE.g, 'm1')
  assert((await last(CYCLE)).includes('Dependency cycle'))
  let [notice] = await CYCLE.g.read('.knock.target=parent&?content')
  assert(String((notice.content as Comp).body).includes('Dependency cycle'))
})

test('a native transcript resumes unattended dependencies when it settles', async () => {
  let calls = 0
  await settle(NATIVE_WORK.g, 's1', {
    holder: 'worker',
    tools: [],
    model: async () => {
      calls++
      await NATIVE_WORK.g.apply([{
        entity: { eid: 'x' },
        completed: { via: 's1' },
      }], { trusted: true })
      return {
        id: 'reply',
        model: 'fake-1',
        items: [{ kind: 'assistant', text: 'finished x' }],
      }
    },
  })
  assertEquals(calls, 1)
  assertEquals(await NATIVE_WORK.claim('x'), 's1')
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

for (let w of CLOSED) {
  test('a task closed while its holder still runs lets its claim go', async () => {
    await w.release('y')
    assertEquals([await w.claim('y'), await w.claim('z')], [undefined, 'm1'])
  })
}

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

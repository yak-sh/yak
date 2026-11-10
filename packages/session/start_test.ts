// A person's comment on an open task no live session holds starts one session
// on it; his next comment reaches that session, and an agent's starts none.
// Committed and worked as the box does: the commit owes `session_start`, a
// pool worker runs it, and the bus feeds what follows.

import { system } from '@yaks/fp'
import { type Bundle, type Comp, graph, type Storage } from '@yaks/graph'
import { docDoc } from '@yaks/doc'
import { effectDoc, effects } from '@yaks/effects'
import { kernelDoc } from '@yaks/kernel/vocab'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { personaDoc } from '@yaks/persona/vocab'
import { processDoc } from '@yaks/process'
import { projectDoc } from '@yaks/project/vocab'
import { provenanceDoc } from '@yaks/provenance'
import { ram } from '@yaks/ram'
import { taskDoc } from '@yaks/task/vocab'
import { equal, test } from '@yaks/testing'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { preparedStore } from '../sqlite/testing.ts'
import { feed } from './bus.ts'
import { sessionDoc } from './comp.ts'
import { hear } from './listen.ts'
import { sessions } from './plugin.ts'
import { starting } from './start.ts'
import { sessionDerived, statusComputed } from './status.ts'
import { watch } from './watch.ts'

let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  processDoc,
  docDoc,
  mailDoc,
  notifyDoc,
  personaDoc,
  projectDoc,
  taskDoc,
  sessionDoc,
  toolsDoc,
  effectDoc,
])
let stores: [string, () => Storage][] = [
  ['RAM', () => ram(vocab, { computed: statusComputed })],
  ['SQLite', () => preparedStore(vocab, { derived: sessionDerived(vocab) })],
]

let JEFF = { by: 'jeff', via: 'web' }
let AGENT = { by: 'taskmaster', via: 'worker' }
let task = (eid: string, more = {}): Bundle => ({
  entity: { eid },
  task: {},
  doc: { title: eid },
  filed: { project: 'p' },
  ...more,
})
let comment = (eid: string, on: string, actor = JEFF): Bundle => ({
  entity: { eid },
  comment: { target: on },
  doc: { body: `${eid} words` },
  $actor: actor,
})

// A project with its operator and a worker at work, Jeff, and a pool worker
// that starts sessions `limit` at a time.
let box = async (storage: Storage, limit = 2) => {
  let now = 0
  let fx = effects(vocab, {
    owner: 'pool',
    defer: true,
    clock: { ...system, now: () => now },
    report: (error) => {
      throw error
    },
  })
  let g = graph({ vocab, storage, plugins: [sessions(), fx] })
  fx.handle(starting(g, {
    limit,
    wait: 10,
    opening: () => ({ persona: 'taskmaster', using: {} }),
  }))
  let agent = (eid: string, more = {}): Bundle[] => [
    { entity: { eid }, session: { id: eid, persona: 'taskmaster', ...more } },
    {
      entity: { eid: `${eid}-asks` },
      entry: { session: eid },
      content: { body: 'go' },
      using: {},
    },
  ]
  await g.apply([
    { entity: { eid: 'pool' }, process: {} },
    { entity: { eid: 'p' }, project: {} },
    { entity: { eid: 'taskmaster' }, persona: { home: 'p' } },
    { entity: { eid: 'jeff' }, person: {}, doc: { title: 'Jeff' } },
    { entity: { eid: 'web' } },
    ...agent('operator', { operator: true }),
    ...agent('worker'),
  ], { trusted: true })
  let say = (...bundles: Bundle[]) => g.apply(bundles)
  let work = async (ms = 0) => {
    now += ms
    await fx.work(g, undefined, 1)
    await feed(g)
  }
  // The sessions started on comments, with each one's inputs and the task it
  // holds.
  let begun = async () => {
    let out: Record<string, unknown>[] = []
    for (let s of await g.read('.session.source&.fields=session.source')) {
      let eid = s.entity.eid
      let said = await g.read(`.entry.session=${eid}&.content&*`)
      out.push({
        on: (s.session as Comp).source,
        holds: (await g.read(`.claim.session=${eid}`)).map((b) => b.entity.eid),
        inputs: said.map((e) =>
          String((e.content as Comp).body).split('\n')[0]
        ),
      })
    }
    return out
  }
  // A started session's turn ends: it answers and rests.
  let settle = async (on: string) => {
    let [s] = await g.read(`.session.source=${on}`)
    await g.apply([{
      entity: { eid: `${on}-answer` },
      entry: { session: s.entity.eid },
      content: { body: 'done' },
      output: { source: s.entity.eid },
    }], { trusted: true })
  }
  let heard = async (session: string) => {
    let lines: string[] = []
    await hear(g, null, session, (line) => lines.push(line))
    return lines
  }
  let waiting = async () =>
    (await g.read('.effect.handler=session_start')).length
  return { g, say, work, begun, settle, heard, waiting }
}

// A scenario run once as the module loads, and what it saw for its test to
// read; a refusal is thrown in the test, not at the load.
let scene = <T>(run: () => Promise<T>): Promise<() => T> =>
  run().then((seen) => () => seen, (error) => () => {
    throw error
  })

let FIRST = 'comment #first on #job from #jeff: first words'
let SECOND = 'comment #second on #job from #jeff: second words'

for (let [name, storage] of stores) {
  let started = await scene(async () => {
    let b = await box(storage())
    await b.g.apply([task('job', { $actor: AGENT })], { trusted: true })
    await b.say(comment('first', 'job'))
    // Before the start runs, nobody else takes it: not the live session that
    // filed the task, and not the operator, by a knock or for the project.
    await feed(b.g)
    await watch(b.g, 'first')
    let others = [await b.heard('worker'), await b.heard('operator')]
    await b.work()
    let first = await b.begun()
    await b.say(comment('second', 'job'))
    let owed = await b.waiting()
    await b.work()
    return { others, first, owed, both: await b.begun() }
  })
  test(`${name}: his comment on an unheld open task starts one session, and his next reaches it`, () => {
    equal(started(), {
      others: [[], []],
      first: [{ on: 'first', holds: ['job'], inputs: [FIRST] }],
      owed: 0,
      both: [{ on: 'first', holds: ['job'], inputs: [FIRST, SECOND] }],
    })
  })

  let none = await scene(async () => {
    let b = await box(storage())
    await b.g.apply([
      task('job'),
      task('done', { completed: {} }),
      task('dropped', { cancelled: {} }),
      task('stuck', { blocked: { on: 'a key' } }),
      task('held', { claim: { session: 'worker' } }),
      { entity: { eid: 'page' }, doc: { title: 'not a task' } },
    ], { trusted: true })
    await b.say(
      comment('agent', 'job', AGENT),
      ...['done', 'dropped', 'stuck', 'held', 'page'].map((on) =>
        comment(`on-${on}`, on)
      ),
    )
    let owed = await b.waiting()
    await b.work()
    return { owed, begun: await b.begun() }
  })
  test(`${name}: a comment owes no start when an agent wrote it or the task is not open work nobody holds`, () => {
    equal(none(), { owed: 0, begun: [] })
  })

  let taken = await scene(async () => {
    let b = await box(storage())
    await b.g.apply([
      { entity: { eid: 'gone' }, session: { id: 'gone', ended: true } },
      task('job', { claim: { session: 'gone' } }),
    ], { trusted: true })
    await b.say(comment('first', 'job'))
    await b.work()
    return (await b.begun()).map((s) => s.holds)
  })
  test(`${name}: a task whose holder is over is taken from it`, () => {
    equal(taken(), [['job']])
  })

  let limited = await scene(async () => {
    let b = await box(storage(), 1)
    await b.g.apply([task('one'), task('two')], { trusted: true })
    await b.say(comment('first', 'one'))
    await b.say(comment('second', 'two'))
    await b.work()
    await b.work(10)
    let on = async () => (await b.begun()).map((s) => s.on).sort()
    let full = { begun: await on(), waiting: await b.waiting() }
    await b.settle('first')
    await b.work(10)
    return { full, after: { begun: await on(), waiting: await b.waiting() } }
  })
  test(`${name}: a start past the limit waits until a started session rests`, () => {
    equal(limited(), {
      full: { begun: ['first'], waiting: 1 },
      after: { begun: ['first', 'second'], waiting: 0 },
    })
  })
}

let moved = await scene(async () => {
  let b = await box(stores[0][1]())
  await b.g.apply([task('job')], { trusted: true })
  await b.say(comment('first', 'job'))
  await b.g.apply([{ entity: { eid: 'job' }, claim: { session: 'worker' } }], {
    trusted: true,
  })
  await b.work()
  let told = await b.g.read('.entry.session=worker&.attention&*')
  return {
    begun: await b.begun(),
    told: told.map((e) => (e.content as Comp).body),
  }
})
test('a task taken before the start runs gets no second session: its holder hears the comment', () => {
  equal(moved(), { begun: [], told: [FIRST] })
})

// Filed by a session that is over, held by a spawned outside run: the
// operator's listener asks first, and the comment is still the run's.
let relayed = await scene(async () => {
  let b = await box(stores[0][1]())
  await b.g.apply([
    { entity: { eid: 'filer' }, session: { id: 'filer', ended: true } },
    {
      entity: { eid: 'run' },
      session: { id: 'run', persona: 'taskmaster' },
      process: {},
    },
    task('job', {
      claim: { session: 'run' },
      $actor: { by: 'taskmaster', via: 'filer' },
    }),
  ], { trusted: true })
  await b.say(comment('first', 'job'))
  await b.work()
  return {
    operator: await b.heard('operator'),
    run: await b.heard('run'),
    begun: await b.begun(),
  }
})
test('his comment on a task an outside run holds is the run’s, though its filer is over and the operator asks first', () => {
  equal(relayed(), { operator: [], run: [FIRST], begun: [] })
})

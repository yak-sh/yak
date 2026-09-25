// The runner as pool work: a request one process writes is answered by any
// process working the pool, and never by two at once; a provider this host
// was lent nothing for is left alone; children wait their turn under the
// bound, and one waiting on its own gives up its place; an entry landing as a
// run lets go is still answered; a withdrawn request is aborted; a worker
// coming up finds what a restart left owed.
// Processes here are graphs over one in-memory SQLite store, which computes a
// transcript's status the way a box's does.

import { assert, assertEquals } from '@std/assert'
import {
  type Bundle,
  type Comp,
  graph,
  identityEid,
  type Storage,
} from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/testing.ts'
import { effectDoc, effects } from '@yaks/effects'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { type Model, modelDoc, type Request } from '@yaks/model'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'
import { transcript } from './react.ts'
import { kindOf, sessionDerived, statusOf } from './status.ts'
import { answers } from './providers.ts'
import { sessionTools } from './children.ts'
import { type Runner, running, settle } from './run.ts'
import { until } from '../../bin/testing.ts'

let worker: VocabDoc = {
  $defs: {
    worker: { component: true, type: 'object', properties: {} },
  },
}
let vocab = loadVocab([sessionDoc, toolsDoc, modelDoc, effectDoc, worker])

let P = identityEid('provider', ['fake'])
let CLI = identityEid('provider', ['claude'])
let M = identityEid('model', ['fake-1'])

let store = (): Storage => {
  let s = storage(mem(), vocab, { derived: sessionDerived })
  s.install()
  graph({ storage: s, vocab }).apply([
    { entity: { eid: P }, provider: { name: 'fake' } },
    {
      entity: { eid: CLI },
      provider: { name: 'claude', transport: 'process' },
    },
    { entity: { eid: M }, model: { name: 'fake-1' } },
    { entity: { eid: 'w1' }, worker: {} },
    { entity: { eid: 'w2' }, worker: {} },
  ], { trusted: true })
  return s
}

// A model that answers every ask with `done`, after `gate` opens where one is
// given, and keeps what it was asked.
let fake = (gate?: Promise<unknown>) => {
  let asked: Request[] = []
  let model: Model = async (req) => {
    asked.push(req)
    await gate
    req.signal?.throwIfAborted()
    return {
      id: `r${asked.length}`,
      model: req.model,
      items: [{
        kind: 'assistant',
        text: 'done',
      }],
    }
  }
  return { model, asked }
}

// A process over `s`: its graph, registry, and the runner it lends.
let proc = (
  s: Storage,
  holder: string,
  model: Model,
  more: Partial<Runner> = {},
) => {
  let fx = effects(vocab, {
    owner: holder,
    write: (b) => g.apply(b, { trusted: true }),
  })
  let g = graph({ storage: s, vocab, plugins: [sessions(), fx] })
  let r: Runner = {
    holder,
    model,
    tools: [],
    answers: answers(g, {}, model),
    ...more,
  }
  fx.handle(running(g, r))
  return { g, fx, r }
}

let ask = (session: string, body = 'say done', provider = P): Bundle[] => [
  { entity: { eid: session }, session: { id: session } },
  {
    entity: { eid: `${session}:in` },
    entry: { session },
    content: { body },
    using: { provider, model: M },
  },
]

// A child of `parent` waiting for its place, with its input.
let child = (eid: string, order: number, parent = 'root'): Bundle[] => [
  {
    entity: { eid },
    session: { id: eid },
    spawned: { parent },
    dispatch: { state: 'queued', order },
  },
  {
    entity: { eid: `${eid}:in` },
    entry: { session: eid },
    content: { body: 'go' },
    using: { provider: P, model: M },
  },
]

let kinds = async (p: { g: ReturnType<typeof graph> }, s: string) =>
  (await transcript(p.g, s)).map(kindOf)

Deno.test('a request one process writes is answered by a process working the pool', async () => {
  let s = store()
  let { model, asked } = fake()
  let writer = proc(s, 'w1', model)
  let server = proc(s, 'w2', model)
  let stop = new AbortController()
  let working = server.fx.work(server.g, stop.signal)
  try {
    await writer.g.apply(ask('s1'))
    await until(async () =>
      statusOf(await transcript(server.g, 's1')) == 'settled'
    )
    assertEquals(await kinds(server, 's1'), ['input', 'ask', 'output'])
    assertEquals(asked.length, 1)
  } finally {
    stop.abort()
    await working
    await server.fx.idle()
  }
})

Deno.test('two processes running one transcript at once ask its model once', async () => {
  let s = store()
  let open!: () => void
  let { model, asked } = fake(new Promise<void>((go) => open = go))
  let a = proc(s, 'w1', model)
  let b = proc(s, 'w2', model)
  await a.g.apply(ask('s1'))
  let both = Promise.all([settle(a.g, 's1', a.r), settle(b.g, 's1', b.r)])
  await until(() => asked.length > 0)
  open()
  await both
  assertEquals(asked.length, 1)
  assertEquals(await kinds(a, 's1'), ['input', 'ask', 'output'])
})

Deno.test('a transcript asking for a provider this host was lent nothing for is left alone', async () => {
  let s = store()
  let { model, asked } = fake()
  let p = proc(s, 'w1', model)
  let stop = new AbortController()
  let working = p.fx.work(p.g, stop.signal)
  try {
    await p.g.apply(ask('s1', 'hi', CLI))
    await p.fx.idle()
    assertEquals(asked.length, 0)
    assertEquals(await kinds(p, 's1'), ['input'])
  } finally {
    stop.abort()
    await working
  }
})

Deno.test('an input landing while its transcript is being run elsewhere is answered after', async () => {
  let s = store()
  let open!: () => void
  let { model, asked } = fake(new Promise<void>((go) => open = go))
  let a = proc(s, 'w1', model)
  let b = proc(s, 'w2', model)
  await a.g.apply(ask('s1'))
  let first = settle(a.g, 's1', a.r)
  await until(() => asked.length == 1)
  await b.g.apply([{
    entity: { eid: 's1:more' },
    entry: { session: 's1' },
    content: { body: 'and again' },
    using: { provider: P, model: M },
  }])
  await settle(b.g, 's1', b.r) // held by `a`: left to it
  open()
  await first
  assertEquals(asked.length, 2)
  assertEquals(statusOf(await transcript(a.g, 's1')), 'settled')
})

Deno.test('children past the bound wait queued, and each ending admits the next', async () => {
  let s = store()
  let { model } = fake()
  let p = proc(s, 'w1', model, { maxChildren: 1 })
  let active: number[] = []
  let stop = new AbortController()
  let working = p.fx.work(p.g, stop.signal)
  try {
    await p.g.apply([
      { entity: { eid: 'root' }, session: { id: 'root' } },
      ...child('c1', 1),
      ...child('c2', 2),
    ])
    await until(async () => {
      active.push((await p.g.read('.dispatch.state=active')).length)
      return (await p.g.read('.dispatch.state=settled')).length == 2
    })
    assert(active.every((n) => n <= 1), `at most one active: ${active}`)
    let told = await p.g.read('.entry.session=root&*')
    assertEquals(told.length, 2)
  } finally {
    stop.abort()
    await working
    await p.fx.idle()
  }
})

Deno.test('a child waiting on its own child gives up its place, and takes one back after', async () => {
  let s = store()
  let { model } = fake()
  let p = proc(s, 'w1', model, { maxChildren: 1 })
  let stop = new AbortController()
  let working = p.fx.work(p.g, stop.signal)
  try {
    await p.g.apply([
      { entity: { eid: 'root' }, session: { id: 'root' } },
      {
        entity: { eid: 'c1' },
        session: { id: 'c1' },
        spawned: { parent: 'root' },
        dispatch: { state: 'active', order: 1 },
      },
      ...child('g1', 2, 'c1'),
    ])
    let wait = sessionTools(p.g, p.r).find((t) => t.name == 'wait')!
    let said = await wait.run({ children: ['g1'], timeout: 5000 }, {
      session: 'c1',
      call: { entity: { eid: 'c1:wait' } },
      entries: [],
    })
    assertEquals(JSON.parse(String(said))[0].status, 'settled')
    let [c1] = await s.tx((tx) => tx.get(['c1']))
    assertEquals((c1.dispatch as Comp).state, 'active')
  } finally {
    stop.abort()
    await working
    await p.fx.idle()
  }
})

Deno.test('a withdrawn streamed request is aborted', async () => {
  let s = store()
  let model: Model = (req) =>
    new Promise((_, no) =>
      req.signal?.addEventListener('abort', () => no(req.signal!.reason))
    )
  let p = proc(s, 'w1', model, { streaming: true, look: 5 })
  await p.g.apply(ask('s1'))
  let run = settle(p.g, 's1', p.r)
  let attempt = await until(async () =>
    (await p.g.read('.entry.session=s1&.attempt.state=inflight'))[0]
  )
  await p.g.apply([{
    entity: { eid: 's1:cancel' },
    entry: { session: 's1' },
    notice: {},
    cancel: { target: attempt.entity.eid },
  }])
  await run
  let entries = await transcript(p.g, 's1')
  let last = entries.findLast((b) => !b.notice)!
  assertEquals((last.error as Comp | undefined)?.code, 'interrupted')
})

Deno.test('a worker coming up runs what a restart left owed', async () => {
  let s = store()
  // Written by a graph keeping no pool: nothing was owed on the way in.
  graph({ storage: s, vocab }).apply(ask('s1'), { trusted: true })
  let { model, asked } = fake()
  let p = proc(s, 'w1', model)
  await p.fx.work(p.g)
  await p.fx.idle()
  assertEquals(asked.length, 1)
  assertEquals(statusOf(await transcript(p.g, 's1')), 'settled')
})

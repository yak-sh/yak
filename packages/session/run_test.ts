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
import { effectDoc, effects, LEASE, leaseEid } from '@yaks/effects'
import { loadVocab, pick, type VocabDoc } from '@yaks/vocab'
import { taskDoc } from '@yaks/task/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { processDoc } from '@yaks/process'
import {
  type Model,
  modelDoc,
  ModelError,
  type Reply,
  type Request,
} from '@yaks/model'
import { toolEid } from '@yaks/tools'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'
import { transcript } from './react.ts'
import { kindOf, sessionDerived, statusOf, textOf } from './status.ts'
import { answers } from './providers.ts'
import { sessionTools } from './children.ts'
import { RUN, type Runner, running, settle } from './run.ts'
import { test, until } from '@yaks/testing'

let worker: VocabDoc = {
  $defs: {
    worker: { component: true, type: 'object', properties: {} },
  },
}
let vocab = loadVocab([
  sessionDoc,
  toolsDoc,
  modelDoc,
  effectDoc,
  processDoc,
  worker,
])

let P = identityEid('provider', ['fake'])
let CLI = identityEid('provider', ['claude'])
let M = identityEid('model', ['fake-1'])

let store = (): Storage => {
  let s = storage(mem(), vocab, { derived: sessionDerived(vocab) })
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

// A process over `s`: its graph, registry, and the runner it lends; `now` is
// its pool's clock, for a test that waits out a backoff.
let proc = (
  s: Storage,
  holder: string,
  model: Model,
  more: Partial<Runner> = {},
  now?: () => number,
) => {
  let fx = effects(vocab, {
    owner: holder,
    write: (b) => g.apply(b, { trusted: true }),
    ...now ? { now } : {},
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

// A provider that answers each ask with `reply(n)`, the nth ask's, which is a
// failure to throw or a reply, and counts the asks.
let script = (reply: (n: number) => ModelError | Reply['items']) => {
  let asks = 0
  let model: Model = (req) => {
    let said = reply(++asks)
    return said instanceof ModelError
      ? Promise.reject(said)
      : Promise.resolve({ id: `r${asks}`, model: req.model, items: said })
  }
  return { model, asks: () => asks }
}
let done: Reply['items'] = [{ kind: 'assistant', text: 'done' }]

// A process working the pool on a clock the test moves, with `s1` asked.
let clocked = async (model: Model) => {
  let clock = { t: 0 }
  let p = proc(store(), 'w1', model, {}, () => clock.t)
  await p.fx.work(p.g)
  await p.g.apply(ask('s1'))
  await p.fx.idle()
  // Move the clock to `t` and work what fell due by then.
  let at = async (t: number) => {
    clock.t = t
    await p.fx.work(p.g)
    await p.fx.idle()
  }
  // The transcript's status as the store computes it, and its newest lines.
  let status = async () =>
    String(((await p.g.get(['s1']))[0].session as Comp).status)
  let last = async (n: number) => (await transcript(p.g, 's1')).slice(-n)
  // When the session's run is next due, if it waits on a backoff.
  let due = async () => {
    let [row] = await p.g.read(
      '.effect.handler=session_run .effect.state=pending .effect.next&*',
    )
    let next = (row?.effect as Comp | undefined)?.next
    return next == null ? undefined : Date.parse(String(next))
  }
  return { p, at, status, last, due }
}

test('a request one process writes is answered by a process working the pool', async () => {
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

test('two processes running one transcript at once ask its model once', async () => {
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

test('a run longer than its lease keeps the transcript, renewed while it goes', async () => {
  let s = store()
  let open!: () => void
  let { model, asked } = fake(new Promise<void>((go) => open = go))
  let a = proc(s, 'w1', model, { hold: 60 })
  let b = proc(s, 'w2', model, { hold: 60 })
  await a.g.apply(ask('s1'))
  let first = settle(a.g, 's1', a.r)
  await until(() => asked.length == 1)
  // Past the hold `a` first took, and renewed beyond it.
  let lease = async () =>
    ((await a.g.get([leaseEid(`${RUN}/s1`)]))[0]?.[LEASE] as
      | { until: string }
      | undefined)?.until
  let taken = await until(lease)
  await until(async () =>
    Date.now() > Date.parse(taken) && await lease() != taken
  )
  await settle(b.g, 's1', b.r) // still `a`'s: left to it
  open()
  await first
  assertEquals(asked.length, 1)
  assertEquals(await kinds(a, 's1'), ['input', 'ask', 'output'])
})

test('a former lease holder takes no next transcript step', async () => {
  let s = store()
  let rival: ReturnType<typeof proc>
  let asks = 0, runs = 0
  let tool = {
    name: 'echo',
    description: 'say it back',
    parameters: { type: 'object', properties: {} },
    run: () => {
      runs++
      return 'echoed'
    },
  }
  let model: Model = async (req) => {
    if (++asks == 1) {
      await rival.g.apply([{
        entity: { eid: leaseEid(`${RUN}/s1`) },
        [LEASE]: {
          name: `${RUN}/s1`,
          holder: 'w2',
          until: new Date(Date.now() + 60_000).toISOString(),
        },
      }])
      return {
        id: 'call',
        model: req.model,
        items: [{ kind: 'call', id: 'c1', name: 'echo', args: '{}' }],
      }
    }
    return {
      id: 'done',
      model: req.model,
      items: [{ kind: 'assistant', text: 'done' }],
    }
  }
  let a = proc(s, 'w1', model, { tools: [tool] })
  rival = proc(s, 'w2', model, { tools: [tool] })
  await a.g.apply([
    { entity: { eid: toolEid('echo') }, tool: { name: 'echo' } },
    ...ask('s1'),
  ])
  await settle(a.g, 's1', a.r)
  assertEquals(runs, 0)
  assertEquals(asks, 1)
  await settle(rival.g, 's1', rival.r)
  assertEquals(runs, 1)
  assertEquals(asks, 2)
  assertEquals(await kinds(a, 's1'), [
    'input',
    'ask',
    'call',
    'result',
    'ask',
    'output',
  ])
})

test('a transcript asking for a provider this host was lent nothing for is left alone', async () => {
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

test('an input landing while its transcript is being run elsewhere is answered after', async () => {
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

test('children past the bound wait queued, and each ending admits the next', async () => {
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

test('a child waiting on its own child gives up its place, and takes one back after', async () => {
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

test('a withdrawn streamed request is aborted', async () => {
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

// An app's store has tasks and no claims: a task finishing there owes a run
// (`completed` is one of `session_run`'s triggers) that no transcript could be
// holding, and a transcript asked for a turn is answered all the same.
test('a graph with tasks and no claims runs its transcripts', async () => {
  let words = loadVocab([
    pick(sessionDoc, [
      'session',
      'entry',
      'ask',
      'using',
      'notice',
      'stop',
      'attempt',
      'cancel',
      'dispatch',
      'session_run',
    ]),
    pick(taskDoc, ['task', 'cancelled']),
    pick(kernelDoc, ['completed']),
    toolsDoc,
    modelDoc,
  ])
  let s = storage(mem(), words, { derived: sessionDerived(words) })
  s.install()
  let reported: unknown[] = []
  let fx = effects(words, { report: (e) => void reported.push(e) })
  let g = graph({ storage: s, vocab: words, plugins: [sessions(), fx] })
  let { model, asked } = fake()
  fx.handle(running(g, { holder: 'w1', model, tools: [] }))
  await g.apply([
    { entity: { eid: P }, provider: { name: 'fake' } },
    { entity: { eid: M }, model: { name: 'fake-1' } },
    { entity: { eid: 't1' }, task: {} },
  ], { trusted: true })
  await g.apply([{ entity: { eid: 't1' }, completed: {} }])
  await g.apply(ask('s1'))
  assertEquals(reported, [])
  assertEquals(asked.length, 1)
  assertEquals(statusOf(await transcript(g, 's1')), 'settled')
})

test('a worker coming up runs what a restart left owed', async () => {
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

test('a transcript ending releases its claims through the effects pool', async () => {
  let s = store()
  let p = proc(s, 'w1', fake().model)
  await p.fx.work(p.g)
  await p.g.apply([
    { entity: { eid: 's1' }, session: { id: 's1' } },
    { entity: { eid: 'work' }, claim: { session: 's1' } },
  ])
  assertEquals(((await p.g.get(['work']))[0].claim as Comp)?.session, 's1')
  await p.g.apply([{
    entity: { eid: 'end' },
    entry: { session: 's1' },
    stop: {},
  }])
  await p.fx.idle()
  assertEquals((await p.g.get(['work']))[0].claim, undefined)
})

test('a managed transcript keeps its claim until its process exits', async () => {
  let p = proc(store(), 'w1', fake().model)
  await p.fx.work(p.g)
  await p.g.apply([
    { entity: { eid: 's1' }, session: {}, process: { pid: 123 } },
    { entity: { eid: 'work' }, claim: { session: 's1' } },
    { entity: { eid: 'end' }, entry: { session: 's1' }, stop: {} },
  ])
  await p.fx.idle()
  assertEquals(((await p.g.get(['work']))[0].claim as Comp)?.session, 's1')
  await p.g.apply([{ entity: { eid: 's1' }, exit: { code: 143 } }])
  await p.fx.idle()
  assertEquals((await p.g.get(['work']))[0].claim, undefined)
})

test('retryable errors keep a claim until the transcript fails', async () => {
  let s = store()
  let p = proc(s, 'w1', fake().model)
  await p.fx.work(p.g)
  await p.g.apply([
    { entity: { eid: 's1' }, session: { id: 's1' } },
    { entity: { eid: 'work' }, claim: { session: 's1' } },
  ])
  for (let i of [1, 2, 3]) {
    await p.g.apply([{
      entity: { eid: `error-${i}` },
      entry: { session: 's1' },
      error: {},
    }])
    await p.fx.idle()
    assertEquals((await p.g.get(['work']))[0].claim != null, i < 3)
  }
})

test('a worker reclaims claims left by already ended transcripts', async () => {
  let s = store()
  await graph({ storage: s, vocab }).apply([
    { entity: { eid: 's1' }, session: { id: 's1' } },
    { entity: { eid: 'work' }, claim: { session: 's1' } },
    { entity: { eid: 'end' }, entry: { session: 's1' }, stop: {} },
    { entity: { eid: 's2' }, session: { id: 's2' } },
    { entity: { eid: 'active' }, claim: { session: 's2' } },
  ])
  let p = proc(s, 'w1', fake().model)
  await p.fx.work(p.g)
  await p.fx.idle()
  assertEquals((await p.g.get(['work']))[0].claim, undefined)
  assertEquals(((await p.g.get(['active']))[0].claim as Comp)?.session, 's2')
})

test('a request the provider failed is asked again once the wait it named is up', async () => {
  let failed = { body: '{"type":"response.failed"}' }
  let { model, asks } = script((n) =>
    n == 1
      ? new ModelError('rate_limit_exceeded', 'try again in 5s', {
        after: 5_000,
      }, failed)
      : done
  )
  let { at, status, last } = await clocked(model)
  // Kept in the provider's words and with what it sent; the ask is cut off,
  // so the session is owed another.
  let [asked, error] = await last(2)
  assertEquals(
    [
      (asked.attempt as Comp).state,
      (error.error as Comp).code,
      (error.response as Comp).body,
    ],
    ['interrupted', 'rate_limit_exceeded', failed.body],
  )
  assertEquals(await status(), 'pending')
  await at(4_999)
  assertEquals(asks(), 1)
  await at(5_000)
  assertEquals([asks(), await status()], [2, 'settled'])
})

test('failures in a row wait longer each time, and the last one stands', async () => {
  let { model, asks } = script(() =>
    new ModelError('unknown', 'responses: failed — unknown', {})
  )
  let { at, status, last, due } = await clocked(model)
  let waits: number[] = []
  for (let t = 0, next; (next = await due()) != null; t = next) {
    waits.push(next - t)
    await at(next)
  }
  // `session_run` declares eight tries: a second, doubling, between them.
  assertEquals(waits, [1, 2, 4, 8, 16, 32, 64].map((s) => s * 1000))
  assertEquals([asks(), await status()], [8, 'failed'])
  let [asked, error] = await last(2)
  assertEquals(
    [(asked.attempt as Comp).state, (error.error as Comp).code, textOf(error)],
    [
      'interrupted',
      'interrupted',
      'Response interrupted: ModelError: responses: failed — unknown',
    ],
  )
})

test('a reply between failures gives the next failure its tries back', async () => {
  // Seven failures, a reply asking for a tool, then one more failure: the
  // eighth try in the run, but the first since the run got somewhere.
  let { model, asks } = script((n) =>
    n <= 7 || n == 9
      ? new ModelError('server_error', 'responses: failed', {})
      : n == 8
      ? [{ kind: 'call', id: 'c1', name: 'nope', args: '{}' }]
      : done
  )
  let { at, status, due } = await clocked(model)
  for (let next; (next = await due()) != null;) await at(next)
  assertEquals([asks(), await status()], [10, 'settled'])
})

test('a provider’s no is not asked again, whatever the pool allows', async () => {
  let { model, asks } = script(() =>
    new ModelError('context_length_exceeded', 'the input is too long')
  )
  let { status, due } = await clocked(model)
  assertEquals([asks(), await status(), await due()], [1, 'failed', undefined])
})

test('graceful stop during preparation admits no ask and leaves the input owed', async () => {
  let stop = new AbortController()
  let entered = false, open!: () => void
  let gate = new Promise<void>((go) => open = go)
  let { model, asked } = fake()
  let p = proc(store(), 'w1', model, {
    stopping: stop.signal,
    contextItems: async () => {
      entered = true
      await gate
      return new Map()
    },
  })
  await p.g.apply(ask('s1'))
  let run = settle(p.g, 's1', p.r)
  await until(() => entered)
  stop.abort()
  open()
  await run
  assertEquals(asked.length, 0)
  assertEquals(await kinds(p, 's1'), ['input'])
  assertEquals(statusOf(await transcript(p.g, 's1')), 'pending')
})

test('graceful stop after ask persistence drains the admitted dispatch', async () => {
  let stop = new AbortController()
  let { model, asked } = fake()
  let p = proc(store(), 'w1', model, { stopping: stop.signal })
  await p.g.apply(ask('s1'))
  let apply = p.g.apply.bind(p.g)
  p.g.apply = async (...args) => {
    let landed = await apply(...args)
    if (landed.some((b) => b.ask)) stop.abort()
    return landed
  }
  await settle(p.g, 's1', p.r)
  assertEquals(asked.length, 1)
  assertEquals(await kinds(p, 's1'), ['input', 'ask', 'output'])
  assertEquals(statusOf(await transcript(p.g, 's1')), 'settled')
})

test('a ready replacement continues a drained multi-step turn without a nudge', async () => {
  let s = store()
  let stop = new AbortController(), nextStop = new AbortController()
  let open!: () => void
  let gate = new Promise<void>((go) => open = go)
  let asks = 0, runs = 0
  let tool = {
    name: 'echo',
    description: 'say it back',
    parameters: { type: 'object', properties: {} },
    run: () => {
      runs++
      return 'echoed'
    },
  }
  let model: Model = async (req) => {
    if (++asks == 1) {
      await gate
      req.signal?.throwIfAborted()
      return {
        id: 'call',
        model: req.model,
        items: [{ kind: 'call', id: 'c1', name: 'echo', args: '{}' }],
      }
    }
    return {
      id: 'done',
      model: req.model,
      items: [{ kind: 'assistant', text: 'done' }],
    }
  }
  let a = proc(s, 'w1', model, { stopping: stop.signal, tools: [tool] })
  let b = proc(s, 'w2', model, { tools: [tool] })
  await a.g.apply([
    { entity: { eid: toolEid('echo') }, tool: { name: 'echo' } },
    ...ask('s1'),
  ])
  let first = a.fx.work(a.g, stop.signal)
  let second: Promise<void> | undefined
  try {
    await until(() => asks == 1)
    let swept = false, read = b.g.read.bind(b.g)
    b.g.read = async (...args) => {
      let rows = await read(...args)
      if (String(args[0]).includes('.session.status=')) swept = true
      return rows
    }
    second = b.fx.work(b.g, nextStop.signal)
    // The replacement's initial sweep runs while the old lease is held.
    await until(() => swept)
    await b.fx.idle()
    await settle(b.g, 's1', b.r) // already tried: old still holds it
    stop.abort()
    open()
    await first
    await a.fx.idle()
    await until(async () => statusOf(await transcript(b.g, 's1')) == 'settled')
    assertEquals(asks, 2)
    assertEquals(runs, 1)
    assertEquals(await kinds(b, 's1'), [
      'input',
      'ask',
      'call',
      'result',
      'ask',
      'output',
    ])
  } finally {
    stop.abort()
    nextStop.abort()
    open()
    await first
    await second
    await a.fx.idle()
    await b.fx.idle()
  }
})

import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { graph, identityEid, mint } from '@yaks/graph'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { loadTools } from '@yaks/graph/tools'
import { loadVocab } from '@yaks/vocab'
import { idDoc, idKeywords } from '@yaks/id'
import { nameKeywords } from '@yaks/names'
import { kernelKeywords, spineDoc } from '@yaks/kernel'
import { ids } from '@yaks/id/graph'
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import { docDoc } from '@yaks/doc'
import { taskDoc } from '@yaks/task'
import { modelDoc } from '@yaks/model'
import { personaDoc } from '@yaks/persona'
import { actorOf, sessionDoc, sessions, statusOf } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { fileDoc } from '@yaks/file/vocab'
import { machineDoc } from '@yaks/machine/vocab'
import {
  answerOf,
  CallError,
  faulted,
  runner,
  toolEid,
  worded,
} from '@yaks/tools'
import { processDoc, processes } from '@yaks/process'
import { spawning } from './effects.ts'
import { fake, until } from './testing.ts'
import { every, runs } from './tools.ts'
import { spawnDoc } from './vocab.ts'
import { transcriptGraph } from '../session/testing.ts'

let comp = (b: Bundle | undefined, name: string) =>
  (b?.[name] ?? undefined) as Comp | undefined

// A host with every word a managed session touches, composed the way `yak
// serve` composes one: the transcript's rules, the process's, and the human
// ids every door takes.
let host = () => {
  let vocab = loadVocab(
    [
      spineDoc,
      idDoc,
      sessionDoc,
      toolsDoc,
      modelDoc,
      fileDoc,
      machineDoc,
      personaDoc,
      processDoc,
      docDoc,
      taskDoc,
      spawnDoc,
      edgeDoc,
    ],
    [kernelKeywords, idKeywords, nameKeywords, edgeKeywords],
  )
  let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let g: Graph = graph({
    storage: ram(vocab, { number: true }),
    vocab,
    plugins: [ids(vocab), sessions(), processes(), fx],
  })
  return { g, fx }
}

let P = identityEid('provider', ['fake'])
let M = identityEid('model', ['fake-1'])

// The shelf a request names: who runs it, what it serves, and the work.
let shelf = [
  { entity: { eid: P }, provider: { name: 'fake', transport: 'process' } },
  { entity: { eid: M }, model: { name: 'fake-1' } },
  {
    entity: { eid: 'the-task' },
    task: {},
    doc: { title: 'ship it', body: 'Keep the owner’s exact requirement.' },
  },
  { ...link(P, 'serves', M), serves: { name: 'fake-1' } },
]

let asked = (g: Graph, args: Record<string, unknown>): [Bundle, Graph] => [
  { entity: { eid: mint() }, call: { args } },
  g,
]

let tools = runs({ graph: undefined as unknown as Graph }, { poll: 5 })

// A call the way a host makes one: through the runner, which resolves every
// argument the declaration marks a reference before the tool is handed it.
let through = async (
  g: Graph,
  name: string,
  args: Record<string, unknown>,
): Promise<Bundle[]> => {
  let r = runner(g, { tools: loadTools(spawnDoc, tools) })
  await r.ensure()
  let id = mint()
  let records = await r.call({
    entity: { eid: id },
    call: { to: toolEid(name), args },
  })
  if (faulted(records, id)) throw new Error(worded(answerOf(records, id)))
  return answerOf(records, id)
}

let body = (bundles: Bundle[]) =>
  String(comp(bundles[0], 'content')?.body ?? '')

test('a duration is what a person says', () => {
  assertEquals(every('45m', 0), 45 * 60_000)
  assertEquals(every('2h', 0), 2 * 3600_000)
  assertEquals(every('90', 0), 90_000)
  assertEquals(every('', 1234), 1234)
  assertEquals(every(undefined, 7), 7)
})

test('a spawn lands the session, the request and the lease', async () => {
  let { g } = host()
  await g.apply(shelf)
  let said = await through(g, 'session_spawn', {
    task: 'T-3',
    provider: P,
    model: M,
    effort: 'high',
  })

  let [session] = await g.read('.session&*')
  assertStringIncludes(body(said), 'spawned')
  // The request is the `using` on the transcript's first entry, and the
  // instruction says which work it is.
  let [entry] = await g.read('.using&*')
  assertEquals(comp(entry, 'using'), {
    provider: P,
    model: M,
    effort: 'high',
  })
  assertEquals(comp(entry, 'entry')?.session, session.entity.eid)
  assertEquals(comp(session, 'session')?.operator, false)
  let source = String(comp(session, 'session')?.source)
  let [request] = await g.get([source])
  assertEquals(comp(request, 'call')?.to, toolEid('session_spawn'))
  assertStringIncludes(String(comp(entry, 'content')?.body), 'ship it')
  assertStringIncludes(
    String(comp(entry, 'content')?.body),
    'Keep the owner’s exact requirement.',
  )
  // And the lease: the board says who is doing it.
  let [held] = await g.read('.claim&*')
  assertEquals(held.entity.eid, 'the-task')
  assertEquals(comp(held, 'claim')?.session, session.entity.eid)
})

let extra = host()
await extra.g.apply(shelf)
test('an added instruction keeps the task body as the spec', async () => {
  let g = extra.g
  await tools.session_spawn!(...asked(g, {
    task: 'the-task',
    provider: P,
    instruction: 'Check the edge case too.',
  }))
  let [entry] = await g.read('.using&*')
  let instruction = String(comp(entry, 'content')?.body)
  assertStringIncludes(instruction, 'Keep the owner’s exact requirement.')
  assertStringIncludes(instruction, 'Check the edge case too.')
})

let delegated = await (async () => {
  let { g } = host()
  let parent = mint()
  let persona = mint()
  await g.apply([
    ...shelf,
    { entity: { eid: persona }, persona: {} },
    { entity: { eid: parent }, session: { persona } },
  ])
  let [call] = asked(g, { task: 'the-task', provider: P })
  await tools.session_spawn!({ ...call, $actor: { via: parent } }, g)
  let [held] = await g.read('.claim&*')
  let child = String(comp(held, 'claim')?.session)
  let [row] = await g.get([child])
  return {
    parent,
    persona,
    spawned: row.spawned,
    actor: await actorOf(g, child),
  }
})()

test('a managed child belongs to its spawning session and speaks as its persona', () => {
  assertEquals(delegated.spawned, { parent: delegated.parent })
  assertEquals(delegated.actor, delegated.persona)
})

test('a spawn records the chosen persona on its session', async () => {
  let { g } = host()
  let persona = crypto.randomUUID()
  await g.apply([
    ...shelf,
    { entity: { eid: persona }, doc: { title: 'Operator' }, persona: {} },
  ])
  await through(g, 'session_spawn', {
    task: 'the-task',
    provider: P,
    persona,
  })
  let [session] = await g.read('.session&*')
  assertEquals(comp(session, 'session')?.persona, persona)
})

test('a spawn refuses what is not a provider, and work that is not there', async () => {
  let { g } = host()
  await g.apply(shelf)
  let refused = async (args: Record<string, unknown>) => {
    try {
      await through(g, 'session_spawn', args)
    } catch (e) {
      return (e as Error).message
    }
    return ''
  }
  assertStringIncludes(
    await refused({ task: 'the-task', provider: M }),
    'names no provider',
  )
  assertStringIncludes(
    await refused({ task: 'T-404', provider: P }),
    'T-404 names nothing',
  )
  assertStringIncludes(
    await refused({ task: 'the-task', provider: P, model: P }),
    'names no model',
  )
  await g.apply([{ entity: { eid: '$other' }, model: { name: 'other' } }])
  assertStringIncludes(
    await refused({
      task: 'the-task',
      provider: P,
      model: identityEid('model', ['other']),
    }),
    'does not serve',
  )
})

test('a run is reached by its graph id or its provider id', async () => {
  let { g } = host()
  await g.apply([
    { entity: { eid: 's' }, session: { id: 'provider-run' } },
    { entity: { eid: 'e1' }, entry: { session: 's' }, content: { body: 'go' } },
    {
      entity: { eid: 'e2' },
      entry: { session: 's' },
      content: { body: 'done' },
      output: { source: 's' },
    },
    { entity: { eid: 'e3' }, entry: { session: 's' }, stop: {} },
    { entity: { eid: 's' }, brief: { text: 'shipped it' } },
  ])
  let seen = body(
    await tools.session_peek!(...asked(g, { session: 'provider-run' })),
  )
  assertStringIncludes(seen, 'stopped')
  assertStringIncludes(seen, 'done')
  assertEquals(seen.split('\n').length, 4) // the head, and one line per entry

  let ended = body(await tools.session_wait!(...asked(g, { session: 's' })))
  assertStringIncludes(ended, 'stopped')
  assertStringIncludes(ended, 'shipped it')
})

test('a peek shows the last lines, and refuses what is not a session', async () => {
  let { g } = host()
  await g.apply([
    { entity: { eid: 's' }, session: {} },
    ...[1, 2, 3, 4].map((n) => ({
      entity: { eid: `e${n}` },
      entry: { session: 's' },
      content: { body: `line ${n}` },
      output: { source: 's' },
    })),
    { entity: { eid: 't' }, task: {}, doc: { title: 'not a session' } },
  ])
  let seen = body(
    await tools.session_peek!(...asked(g, { session: 's', lines: 2 })),
  )
  assertEquals(seen.split('\n').length, 3)
  assertStringIncludes(seen, 'line 4')
  assert(!seen.includes('line 1'))

  await assertRejects(
    () => Promise.resolve(tools.session_wait!(...asked(g, { session: 't' }))),
    CallError,
    'not a session',
  )
})

test('a peek keeps the entire last multiline output within its entry limit', async () => {
  let { g } = host()
  let final =
    'A final report longer than seventy characters is still entirely readable.\nSecond line of the report\nThird line'
  await g.apply([
    { entity: { eid: 's' }, session: {} },
    {
      entity: { eid: 'e1' },
      entry: { session: 's' },
      content: { body: 'earlier' },
    },
    {
      entity: { eid: 'e2' },
      entry: { session: 's' },
      content: { body: final },
      output: { source: 's' },
    },
  ])
  let seen = body(await through(g, 'session_peek', { session: 's', lines: 1 }))
  assertStringIncludes(seen, final)
  assert(!seen.includes('earlier'))
})

test('a peek bounds transcript reads and previews a large entry', async () => {
  let { g } = host()
  await g.apply([
    { entity: { eid: 's' }, session: {} },
    {
      entity: { eid: 'e1' },
      entry: { session: 's' },
      content: { body: 'earlier' },
    },
    {
      entity: { eid: 'e2' },
      entry: { session: 's' },
      content: { body: 'A'.repeat(100_000) },
      output: { source: 's' },
    },
  ])
  let read = g.read.bind(g), get = g.get.bind(g)
  g.read = ((q: string, ...rest: unknown[]) => {
    if (q.includes('.entry.session=') && !q.includes('.limit=')) {
      throw new Error('unbounded transcript read')
    }
    return read(q, ...rest as [])
  }) as typeof g.read
  g.get =
    (async (ids, comps) =>
      (await get(ids, comps)).map((b) =>
        b.session
          ? { ...b, session: { ...(b.session as Comp), status: 'settled' } }
          : b
      )) as typeof g.get

  let seen = body(
    await tools.session_peek!(...asked(g, {
      session: 's',
      lines: 1,
    })),
  )
  assertStringIncludes(seen, 'settled')
  assertStringIncludes(seen, '[100000 characters total]')
  assert(seen.length < 17_000)
  assert(!seen.includes('earlier'))
})

test('a transcript-only wait returns when its output settles', async () => {
  let { g } = host()
  await g.apply([
    { entity: { eid: 's' }, session: {} },
    {
      entity: { eid: 'e1' },
      entry: { session: 's' },
      content: { body: 'go' },
      ask: {},
    },
    {
      entity: { eid: 'e2' },
      entry: { session: 's' },
      content: { body: 'finished' },
      output: { source: 'e1' },
    },
    { entity: { eid: 's' }, brief: { text: 'all done' } },
  ])
  let said = body(
    await through(g, 'session_wait', { session: 's', timeout: '0' }),
  )
  assertStringIncludes(said, 'settled')
  assertStringIncludes(said, 'all done')
  assert(!said.includes('still running'))
})

test('a wait answers "still running" rather than killing anything', async () => {
  let { g } = host()
  await g.apply([
    { entity: { eid: 's' }, session: {} },
    { entity: { eid: 'e1' }, entry: { session: 's' }, content: { body: 'go' } },
  ])
  let said = body(
    await tools.session_wait!(...asked(g, { session: 's', timeout: '0' })),
  )
  assertStringIncludes(said, 'still running')
})

test('a wait answers when the server answering it starts to stop', async () => {
  let { g } = host()
  await g.apply([
    { entity: { eid: 's' }, session: {} },
    { entity: { eid: 'e1' }, entry: { session: 's' }, content: { body: 'go' } },
  ])
  let stopping = new AbortController()
  let wait = runs({ graph: g, stopping: stopping.signal }, { poll: 5 })
    .session_wait!(...asked(g, { session: 's' }))
  stopping.abort()
  let said = body(await wait)
  assertStringIncludes(said, 'still running')
  assertStringIncludes(said, 'wait again')
})

// The whole machine, with a provider that is a shell script: the request
// starts it, the wait blocks on the process ending rather than the transcript,
// and the peek reads back what it said.
test('spawn --wait runs the provider and answers what it came to', async () => {
  let { g, fx } = host()
  let where = Deno.makeTempDirSync({ prefix: 'yaks-spawn-tools-' })
  fx.handle(
    spawning({ adapters: { fake }, dir: where, poll: 5 })({ graph: g }),
  )
  try {
    await g.apply(shelf)
    let said = body(
      await tools.session_spawn!(
        ...asked(g, {
          task: 'the-task',
          provider: P,
          model: M,
          wait: true,
          timeout: '30',
        }),
      ) as Bundle[],
    )
    assertStringIncludes(said, 'exited 0')
    assertStringIncludes(said, 'working: ') // its own last word, as the brief

    let [session] = await g.read('.session&*')
    let seen = body(
      await tools.session_peek!(...asked(g, { session: session.entity.eid })),
    )
    assertStringIncludes(seen, 'working: ')
    await until(async () => (await g.read('.stop&*')).length, 'the ending')
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
})

test('session stop ends a managed run', async () => {
  let { g, fx } = host()
  let where = Deno.makeTempDirSync({ prefix: 'yaks-spawn-stop-' })
  fx.handle(
    spawning({ adapters: { fake }, dir: where, poll: 5, grace: 500 })(
      { graph: g },
    ),
  )
  try {
    await g.apply(shelf)
    await through(g, 'session_spawn', {
      task: 'the-task',
      provider: P,
      instruction: 'linger here',
    })
    let row = await until(async () => {
      let [session] = await g.read('.session&*')
      return comp(session, 'process')?.pid ? session : undefined
    }, 'the managed run to start') as Bundle
    await through(g, 'session_stop', { session: row.entity.eid })
    await until(
      async () => comp((await g.get([row.entity.eid]))[0], 'exit'),
      'the managed run to stop',
    )
    let [stopped] = await g.get([row.entity.eid])
    assertEquals(stopped.entity.num, row.entity.num)
    assertEquals(comp(stopped, 'stop'), {})
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
})

// The stop door needs no process behind a native transcript.
let nativeVocab = loadVocab([spineDoc, sessionDoc, toolsDoc, modelDoc])
let native = transcriptGraph(nativeVocab)
await native.apply([
  { entity: { eid: 's' }, session: {} },
  {
    entity: { eid: 'input' },
    entry: { session: 's' },
    using: { provider: P, model: M },
    content: { body: 'go' },
  },
  { entity: { eid: P }, provider: { name: 'fake', transport: 'http' } },
  { entity: { eid: M }, model: { name: 'fake-1' } },
])
test('session stop ends a native transcript', async () => {
  await tools.session_stop!(...asked(native, { session: 's' }))
  let entries = await native.read('.entry.session=s .stop')
  assertEquals(statusOf(entries), 'stopped')
  await native.apply(
    entries.filter((b) => b.stop).map((entry) => ({
      entity: entry.entity,
      stop: null,
    })),
  )
})

test('session stop honors native ownership even for a process provider', async () => {
  let g = transcriptGraph(nativeVocab)
  await g.apply([
    { entity: { eid: 'claude-native' }, session: {}, native: {} },
    {
      entity: { eid: 'input-c' },
      entry: { session: 'claude-native' },
      using: { provider: P, model: M },
      content: { body: 'go' },
    },
    { entity: { eid: P }, provider: { name: 'claude', transport: 'process' } },
    { entity: { eid: M }, model: { name: 'haiku' } },
  ])
  await tools.session_stop!(...asked(g, { session: 'claude-native' }))
  assertEquals(
    statusOf(await g.read('.entry.session=claude-native&*')),
    'stopped',
  )
  assertEquals((await g.get(['claude-native']))[0].stop, undefined)
})

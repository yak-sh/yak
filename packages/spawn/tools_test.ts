import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { graph, identityEid } from '@yaks/graph'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { loadTools } from '@yaks/graph/tools'
import { loadVocab } from '@yaks/vocab'
import { idDoc, idKeywords } from '@yaks/id'
import { nameKeywords } from '@yaks/names'
import { kernelKeywords, spineDoc } from '@yaks/kernel'
import { ids } from '@yaks/id/rules'
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import { docDoc } from '@yaks/doc'
import { taskDoc } from '@yaks/task'
import { modelDoc } from '@yaks/model'
import { sessionDoc, sessions } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
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
  { entity: { eid: P }, provider: { name: 'fake' } },
  { entity: { eid: M }, model: { name: 'fake-1' } },
  { entity: { eid: 'the-task' }, task: {}, doc: { title: 'ship it' } },
  { ...link(P, 'serves', M), serves: { name: 'fake-1' } },
]

let asked = (g: Graph, args: Record<string, unknown>): [Bundle, Graph] => [
  { entity: { eid: 'the-call' }, call: { args } },
  g,
]

let tools = runs({ graph: undefined as unknown as Graph }, { poll: 20 })

// A call the way a host makes one: through the runner, which resolves every
// argument the declaration marks a reference before the tool is handed it.
let through = async (
  g: Graph,
  name: string,
  args: Record<string, unknown>,
): Promise<Bundle[]> => {
  let r = runner(g, { tools: loadTools(spawnDoc, tools) })
  await r.ensure()
  let records = await r.call({
    entity: { eid: '$call' },
    call: { to: toolEid(name), args },
  })
  if (faulted(records)) throw new Error(worded(answerOf(records)))
  return answerOf(records)
}

let body = (bundles: Bundle[]) =>
  String(comp(bundles[0], 'content')?.body ?? '')

Deno.test('every spawn tool is declared and implemented', () => {
  assertEquals(loadTools(spawnDoc, tools).map((t) => t.name).sort(), [
    'session_peek',
    'session_spawn',
    'session_wait',
  ])
})

Deno.test('a duration is what a person says', () => {
  assertEquals(every('45m', 0), 45 * 60_000)
  assertEquals(every('2h', 0), 2 * 3600_000)
  assertEquals(every('90', 0), 90_000)
  assertEquals(every('', 1234), 1234)
  assertEquals(every(undefined, 7), 7)
})

Deno.test('a spawn lands the session, the request and the lease', async () => {
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
  assertStringIncludes(String(comp(entry, 'content')?.body), 'ship it')
  // And the lease: the board says who is doing it.
  let [held] = await g.read('.claim&*')
  assertEquals(held.entity.eid, 'the-task')
  assertEquals(comp(held, 'claim')?.session, session.entity.eid)
})

Deno.test('a spawn refuses what is not a provider, and work that is not there', async () => {
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

Deno.test('a run is reached by its graph id or its provider id', async () => {
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

Deno.test('a peek shows the last lines, and refuses what is not a session', async () => {
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

Deno.test('a wait answers "still running" rather than killing anything', async () => {
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

// The whole machine, with a provider that is a shell script: the request
// starts it, the wait blocks on the process ending rather than the transcript,
// and the peek reads back what it said.
Deno.test('spawn --wait runs the provider and answers what it came to', async () => {
  let { g, fx } = host()
  let where = Deno.makeTempDirSync({ prefix: 'yaks-spawn-tools-' })
  fx.handle(
    spawning({ adapters: { fake }, dir: where, poll: 20 })({ graph: g }),
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

import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import type { Bundle, Comp, Graph, ToolCtx } from '@yaks/graph'
import { graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { loadVocab } from '@yaks/vocab'
import { idKeywords } from '@yaks/id'
import { nameKeywords } from '@yaks/names'
import { ids, kernelKeywords, spineDoc } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import { docDoc } from '@yaks/doc'
import { taskDoc } from '@yaks/task'
import { modelDoc } from '@yaks/model'
import { sessionDoc, sessions } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { processDoc, processes, selfEid } from '@yaks/process'
import { spawning } from './effects.ts'
import { fake, slow, until } from './harness.ts'
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
      sessionDoc,
      toolsDoc,
      modelDoc,
      processDoc,
      docDoc,
      taskDoc,
      spawnDoc,
    ],
    [kernelKeywords, idKeywords, nameKeywords],
  )
  let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let g: Graph = graph({
    storage: ram(vocab, { number: true }),
    vocab,
    plugins: [ids(vocab), sessions(), processes(), fx],
  })
  return { g, fx }
}

// The shelf a request names: who runs it, what it serves, and the work.
let shelf = [
  { entity: { eid: 'p-fake' }, provider: { name: 'fake' } },
  { entity: { eid: 'm-fake' }, model: { name: 'fake-1', provider: 'p-fake' } },
  { entity: { eid: 'the-task' }, task: {}, doc: { title: 'ship it' } },
]

let ctx = (g: Graph, args: Record<string, unknown>): ToolCtx => ({
  graph: g,
  actor: null,
  read: (q, o) => g.read(q, o),
  args,
  call: 'the-call',
})

let tools = runs({ graph: undefined as unknown as Graph }, { poll: 20 })

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
  let said = await tools.session_spawn!(
    [],
    ctx(g, {
      task: 'T-3',
      provider: 'p-fake',
      model: 'm-fake',
      effort: 'high',
    }),
  ) as Bundle[]

  let [session] = await g.read('.session')
  assertStringIncludes(body(said), 'spawned')
  // The request is the `using` on the transcript's first entry, and the
  // instruction says which work it is.
  let [entry] = await g.read('.using')
  assertEquals(comp(entry, 'using'), {
    provider: 'p-fake',
    model: 'm-fake',
    effort: 'high',
  })
  assertEquals(comp(entry, 'entry')?.session, session.entity.eid)
  assertStringIncludes(String(comp(entry, 'content')?.body), 'ship it')
  // And the lease: the board says who is doing it.
  let [held] = await g.read('.claim')
  assertEquals(held.entity.eid, 'the-task')
  assertEquals(comp(held, 'claim')?.session, session.entity.eid)
})

Deno.test('a spawn refuses what is not a provider, and work that is not there', async () => {
  let { g } = host()
  await g.apply(shelf)
  let refused = async (args: Record<string, unknown>) => {
    try {
      await tools.session_spawn!([], ctx(g, args))
    } catch (e) {
      return (e as Error).message
    }
    return ''
  }
  assertStringIncludes(
    await refused({ task: 'the-task', provider: 'm-fake' }),
    'not a provider',
  )
  assertStringIncludes(
    await refused({ task: 'T-404', provider: 'p-fake' }),
    'no such task',
  )
  assertStringIncludes(
    await refused({ task: 'the-task', provider: 'p-fake', model: 'p-fake' }),
    'not a model',
  )
})

Deno.test('a peek is the transcript, and a wait on a stopped one is its ending', async () => {
  let { g } = host()
  await g.apply([
    { entity: { eid: 's' }, session: {} },
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
  let seen = body(await tools.session_peek!([], ctx(g, { session: 's' })))
  assertStringIncludes(seen, 'stopped')
  assertStringIncludes(seen, 'done')
  assertEquals(seen.split('\n').length, 4) // the head, and one line per entry

  let ended = body(await tools.session_wait!([], ctx(g, { session: 's' })))
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
    await tools.session_peek!([], ctx(g, { session: 's', lines: 2 })),
  )
  assertEquals(seen.split('\n').length, 3)
  assertStringIncludes(seen, 'line 4')
  assert(!seen.includes('line 1'))

  let said = await Promise.resolve(
    tools.session_wait!([], ctx(g, { session: 't' })),
  ).then(() => '', (e: Error) => e.message)
  assertStringIncludes(said, 'not a session')
})

Deno.test('a wait answers "still running" rather than killing anything', async () => {
  let { g } = host()
  await g.apply([
    { entity: { eid: 's' }, session: {} },
    { entity: { eid: 'e1' }, entry: { session: 's' }, content: { body: 'go' } },
  ])
  let said = body(
    await tools.session_wait!([], ctx(g, { session: 's', timeout: '0' })),
  )
  assertStringIncludes(said, 'still running')
})

// The whole machine, with a provider that is a shell script: the request
// starts it, the wait blocks on the process ending rather than the transcript,
// and the peek reads back what it said.
slow('spawn --wait runs the provider and answers what it came to', async () => {
  let { g, fx } = host()
  let where = Deno.makeTempDirSync({ prefix: 'yaks-spawn-tools-' })
  for (
    let { comp, ...watch } of spawning({
      adapters: { fake },
      dir: where,
      poll: 20,
    })({ graph: g, me: selfEid() })
  ) fx.on(comp, watch)
  try {
    await g.apply(shelf)
    let said = body(
      await tools.session_spawn!(
        [],
        ctx(g, {
          task: 'the-task',
          provider: 'p-fake',
          model: 'm-fake',
          wait: true,
          timeout: '30',
        }),
      ) as Bundle[],
    )
    assertStringIncludes(said, 'exited 0')
    assertStringIncludes(said, 'working: ') // its own last word, as the brief

    let [session] = await g.read('.session')
    let seen = body(
      await tools.session_peek!([], ctx(g, { session: session.entity.eid })),
    )
    assertStringIncludes(seen, 'working: ')
    await until(async () => (await g.read('.stop')).length, 'the ending')
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
})

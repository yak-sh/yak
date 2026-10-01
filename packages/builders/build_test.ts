import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from '@std/assert'
import type { Bundle, Comp, Graph, Tool } from '@yaks/graph'
import { Refused } from '@yaks/graph'
import { keyed, keyEid, unkeyed } from '@yaks/key'
import type { Vocab } from '@yaks/vocab'
import { edgeEid } from '@yaks/edge'
import { CallError, toolEid } from '@yaks/tools'
import { marksDoc } from '@yaks/kernel/vocab'
import { ids, noon, shop } from './testing.ts'
import {
  BUILD_OF,
  buildFor,
  buildOf,
  current,
  OUTPUT_OF,
  outputFor,
  outputOf,
  selected,
} from './build.ts'
import { answer as answerWrites } from './answer.ts'
import { key } from './key.ts'
import { modelTool, render } from './model.ts'
import { build, runs } from './tools.ts'
import { builderDoc } from './vocab.ts'
import { loadTools } from '@yaks/graph/tools'

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined
let rows = async (g: Graph, q: string) => await g.read(`${q}&*`)
let one = async (g: Graph, eid: string) => (await g.get([eid]))[0]
// A build and an output, found by their keys.
let runOf = async (
  g: Graph,
  entities: (string | null)[],
  variant = 'main',
  builder = ids.builder,
) => (await buildFor(g, builder, entities, variant))!
let outOf = async (g: Graph, build: string, slot = 'main') =>
  (await outputFor(g, build, slot))!
let source = (eid: string, body = 'first'): Bundle => ({
  entity: { eid },
  doc: { title: 'Source', body },
})
let builder = (query = '.doc.title=Source', to = toolEid('code')): Bundle => ({
  entity: { eid: ids.builder },
  builder: { query, to, immediate: true },
  content: { body: 'Build $s' },
})
let answer = (call: Bundle, body = 'Made'): Bundle[] => [{
  entity: { eid: crypto.randomUUID() },
  output: {
    source: call.entity.eid,
    value: {
      outputs: [{
        slot: 'main',
        inputs: [String(
          (comp(call, 'call')?.args as {
            binding: { entities: string[] }
          }).binding.entities[0],
        )],
        components: { doc: { body } },
      }],
    },
  },
}]
let code = (revision = '1'): Tool => ({
  name: 'code',
  description: 'Build one source',
  revision,
  inputSchema: {
    type: 'object',
    properties: {
      binding: { type: 'object' },
      key: { type: 'string' },
      template: { type: 'string' },
      using: { type: 'object' },
    },
    required: ['binding', 'key'],
  },
  run: (call) => answer(call),
})
// A code tool whose answer is these outputs, or what a function says they are
// at the time it is asked.
let answering = (outputs: unknown[] | (() => unknown[])): Tool => ({
  ...code(),
  run: (call) => [{
    entity: { eid: crypto.randomUUID() },
    output: {
      source: call.entity.eid,
      value: { outputs: typeof outputs == 'function' ? outputs() : outputs },
    },
  }],
})
// A component with a reference of its own.
let notes = {
  $defs: {
    note: {
      component: true,
      type: 'object',
      properties: {
        parent: { type: 'string', ref: 'entity' },
        text: { type: 'string' },
      },
    },
  },
}
let calls = (g: Graph, build: string) => rows(g, `.call.source=${build}`)
// A model's ask in a transcript, and a reply to it.
let asked = (
  session: string,
  seq: number,
  eid: string,
  state: string,
): Bundle => ({
  entity: { eid },
  entry: { session, seq },
  ask: { to: ids.model },
  attempt: { state },
})
let replied = (
  session: string,
  seq: number,
  ask: string,
  body: string,
  eid: string = crypto.randomUUID(),
): Bundle => ({
  entity: { eid },
  entry: { session, seq },
  content: { body },
  output: { source: ask },
})
let drive = async (
  g: Graph,
  r: Awaited<ReturnType<typeof shop>>['runner'],
  build: string,
) => {
  let pending = await calls(g, build)
  await r.due(pending.at(-1)!.entity.eid)
}
// `builder build` on the test's builder, as a host loads the tool: through its
// declaration in the vocabulary.
let asking = (g: Graph, vocab: Vocab) => {
  let [tool] = loadTools(builderDoc, runs({ vocab }))
    .filter((t) => t.name == 'builder_build')
  return async (args: Comp = {}) =>
    await tool.run({
      entity: { eid: crypto.randomUUID() },
      call: { args: { builder: ids.builder, ...args } },
    }, g)
}
let ring: Bundle = {
  entity: { eid: 'ring' },
  wake: { target: ids.builder },
  fired: { at: noon() },
}
let match = (b: Bundle): string[] => JSON.parse(String(comp(b, 'build')?.match))
// The sources the test builder's main builds were made for, and one's build.
let built = async (g: Graph) =>
  (await rows(g, `.build.builder=${ids.builder}&.build.variant=main`))
    .map((b) => match(b)[0]).toSorted()
let mainOf = async (g: Graph, s: string) =>
  comp(await one(g, await runOf(g, [s])), 'build')
let keyOf = async (g: Graph, s: string) => (await mainOf(g, s))?.key
let staleOf = async (g: Graph, s: string) => (await mainOf(g, s))?.stale
let currentOf = async (g: Graph, s: string) =>
  current(
    (await mainOf(g, s))!,
    comp(await one(g, await outOf(g, await runOf(g, [s]))), 'built')!,
  )

test('reconciliation reuses keyed owners outside build history in a batch', async () => {
  let { g, vocab } = await shop({}, [], [code()])
  await g.apply([
    source('a'),
    source('b'),
    { ...builder(), staged: {} },
    ...['a', 'b'].flatMap((s): Bundle[] => [
      {
        entity: { eid: `owner-${s}` },
        build: { builder: ids.builder, match: '["old"]', variant: 'old' },
        doc: { body: 'Keep the owner' },
      },
      keyed(BUILD_OF, `owner-${s}`, buildOf(ids.builder, JSON.stringify([s]))),
      {
        entity: { eid: `history-${s}` },
        build: {
          builder: ids.builder,
          match: JSON.stringify([s]),
          variant: 'main',
        },
      },
    ]),
  ])
  let builds = await build(g, vocab, { builder: ids.builder }, null)
  assertEquals(builds.toSorted(), ['owner-a', 'owner-b'])
  for (let s of ['a', 'b']) {
    assertEquals(await runOf(g, [s]), `owner-${s}`)
    assertEquals(
      comp(await one(g, `owner-${s}`), 'build')?.match,
      JSON.stringify([s]),
    )
    assertEquals(
      comp(await one(g, `owner-${s}`), 'doc')?.body,
      'Keep the owner',
    )
    assertEquals((await calls(g, `owner-${s}`)).length, 1)
    assertEquals(comp(await one(g, `history-${s}`), 'build')?.stale, true)
    assertEquals((await calls(g, `history-${s}`)).length, 0)
  }
  assertEquals(await build(g, vocab, { builder: ids.builder }, null), builds)
  assertEquals((await calls(g, 'owner-a')).length, 1)
  assertEquals((await calls(g, 'owner-b')).length, 1)
})

test('a matching build without its key is history, not a reuse fallback', async () => {
  let { g, vocab } = await shop({}, [], [code()])
  await g.apply([
    source('a'),
    { ...builder(), staged: {} },
    {
      entity: { eid: 'history' },
      build: { builder: ids.builder, match: '["a"]', variant: 'main' },
    },
  ])
  let [made] = await build(g, vocab, { builder: ids.builder }, null)
  assertNotEquals(made, 'history')
  assertEquals(await runOf(g, ['a']), made)
  assertEquals(comp(await one(g, 'history'), 'build')?.stale, true)
  assertEquals((await calls(g, 'history')).length, 0)
})

test('an answer reuses keyed slot owners outside output history and resolves siblings', async () => {
  let tool = answering([
    { slot: 'main', inputs: ['a'], components: { doc: { body: 'Made' } } },
    {
      slot: 'note',
      inputs: [],
      components: { note: { parent: '$main', text: 'Sibling' } },
    },
  ])
  let { g, vocab, runner, failed } = await shop({}, [notes], [tool])
  await g.apply([source('a'), { ...builder(), staged: {} }])
  let [run] = await build(g, vocab, { builder: ids.builder }, null)
  await g.apply(
    ['main', 'note'].flatMap((slot): Bundle[] => [
      {
        entity: { eid: `owner-${slot}` },
        doc: { title: 'Keep me' },
        built: {
          build: 'older-build',
          slot: 'old',
          call: 'older-call',
          key: 'before',
        },
      },
      keyed(OUTPUT_OF, `owner-${slot}`, outputOf(run, slot)),
      {
        entity: { eid: `history-${slot}` },
        built: { build: run, slot, key: 'old' },
        doc: { body: 'History' },
      },
    ]),
    { trusted: true },
  )
  await drive(g, runner, run)
  assertEquals(failed, [])
  assertEquals(await outOf(g, run), 'owner-main')
  assertEquals(await outOf(g, run, 'note'), 'owner-note')
  assertEquals(comp(await one(g, 'owner-main'), 'doc'), {
    title: 'Keep me',
    body: 'Made',
  })
  assertEquals(comp(await one(g, 'owner-note'), 'note')?.parent, 'owner-main')
  for (let slot of ['main', 'note']) {
    assertEquals(comp(await one(g, `owner-${slot}`), 'built')?.build, run)
    assertEquals(comp(await one(g, `history-${slot}`), 'doc')?.body, 'History')
    assertEquals(comp(await one(g, `history-${slot}`), 'built')?.key, 'old')
  }
  assertEquals((await rows(g, '.edge.from=owner-main&.cites')).length, 1)
})

test('a matching output without its key is retained history, not a slot fallback', async () => {
  let { g, vocab, runner, failed } = await shop({}, [], [code()])
  await g.apply([source('a'), { ...builder(), staged: {} }])
  let [run] = await build(g, vocab, { builder: ids.builder }, null)
  await g.apply([{
    entity: { eid: 'history' },
    built: { build: run, slot: 'main', key: 'old' },
    doc: { body: 'History' },
  }], { trusted: true })
  await drive(g, runner, run)
  assertEquals(failed, [])
  let made = await outOf(g, run)
  assertNotEquals(made, 'history')
  assertEquals(comp(await one(g, made), 'doc')?.body, 'Made')
  assertEquals(comp(await one(g, 'history'), 'doc')?.body, 'History')
  assertEquals(comp(await one(g, 'history'), 'built')?.key, 'old')
})

test('outer query bindings make independent builds and tool calls', async () => {
  let { g, runner } = await shop({}, [], [code()])
  await g.apply([source('a'), source('b'), builder()])
  let a = await runOf(g, ['a'])
  let b = await runOf(g, ['b'])
  assertNotEquals(a, b)
  assertEquals((await rows(g, '.build')).length, 2)
  let [asked] = await calls(g, a)
  assertEquals(comp(asked, 'call')?.to, toolEid('code'))
  assertEquals(
    (comp(asked, 'call')?.args as { binding: { entities: string[] } })
      .binding.entities,
    ['a'],
  )
  await drive(g, runner, a)
  await drive(g, runner, b)
  assertEquals(comp(await one(g, await outOf(g, a)), 'doc')?.body, 'Made')
  assertEquals(comp(await one(g, await outOf(g, b)), 'built')?.build, b)
  let cited = await one(g, edgeEid(await outOf(g, a), 'cites', 'a'))
  assert(cited?.cites)
})

test('nested collection changes the key but retains the build and output', async () => {
  let { g, runner } = await shop({}, [notes], [code()])
  let query = '$s .doc.title=Source; [$n .note.parent=$s]'
  await g.apply([source('a'), builder(query)])
  let build = await runOf(g, ['a'])
  let before = comp(await one(g, build), 'build')?.key
  await drive(g, runner, build)
  await g.apply([{ entity: { eid: 'n1' }, note: { parent: 'a', text: 'one' } }])
  assertEquals((await rows(g, '.build')).length, 1)
  assertNotEquals(comp(await one(g, build), 'build')?.key, before)
  assertEquals((await calls(g, build)).length, 2)
  await drive(g, runner, build)
  assertEquals((await rows(g, '.built')).length, 1)
  assertEquals(
    comp(await one(g, await outOf(g, build)), 'built')?.key,
    comp(await one(g, build), 'build')?.key,
  )
  let withNote = comp(await one(g, build), 'build')?.key
  await g.apply([{ entity: { eid: 'n1' }, $delete: true }])
  assertEquals((await rows(g, '.build')).length, 1)
  assertEquals(comp(await one(g, build), 'build')?.stale, false)
  assertNotEquals(comp(await one(g, build), 'build')?.key, withNote)
})

test('vanished bindings preserve history and returning bindings reuse it', async () => {
  let { g, runner } = await shop({}, [], [code()])
  await g.apply([source('a'), builder()])
  let build = await runOf(g, ['a'])
  await drive(g, runner, build)
  let made = await outOf(g, build)
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'Elsewhere' } }])
  assertEquals(comp(await one(g, build), 'build')?.stale, true)
  assert(await one(g, made))
  assertEquals(
    current(
      comp(await one(g, build), 'build')!,
      comp(await one(g, made), 'built')!,
    ),
    false,
  )
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'Source' } }])
  assertEquals(comp(await one(g, build), 'build')?.stale, false)
  assertEquals((await calls(g, build)).length, 1)
  assertEquals(comp(await one(g, made), 'built')?.build, build)
  assert(current(
    comp(await one(g, build), 'build')!,
    comp(await one(g, made), 'built')!,
  ))
})

test('an answer that lands after its binding vanished is kept for its return', async () => {
  let { g, runner } = await shop({}, [], [code()])
  await g.apply([source('a'), builder()])
  let build = await runOf(g, ['a'])
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'Elsewhere' } }])
  await drive(g, runner, build)
  let made = comp(await one(g, await outOf(g, build)), 'built')!
  assertEquals(current(comp(await one(g, build), 'build')!, made), false)
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'Source' } }])
  assert(current(comp(await one(g, build), 'build')!, made))
  assertEquals((await calls(g, build)).length, 1)
})

test('an output names a sibling output of its answer by $slot', async () => {
  let kinded = answering([
    { slot: 'kind', inputs: ['a'], components: { doc: { body: '$cry' } } },
    { slot: 'cry', inputs: [], components: { note: { parent: '$kind' } } },
  ])
  let { g, runner, failed } = await shop({}, [notes], [kinded])
  await g.apply([source('a'), builder()])
  let build = await runOf(g, ['a'])
  await drive(g, runner, build)
  assertEquals(failed, [])
  let cry = await one(g, await outOf(g, build, 'cry'))
  assertEquals(comp(cry, 'note')?.parent, await outOf(g, build, 'kind'))
  // Only a reference names an entity; text keeps what it says.
  assertEquals(
    comp(await one(g, await outOf(g, build, 'kind')), 'doc')?.body,
    '$cry',
  )

  let astray = answering([
    { slot: 'cry', inputs: [], components: { note: { parent: '$nowhere' } } },
  ])
  let lost = await shop({}, [notes], [astray])
  await lost.g.apply([source('a'), builder()])
  await drive(lost.g, lost.runner, await runOf(lost.g, ['a']))
  assertEquals((await rows(lost.g, '.built')).length, 0)
  assert(String(lost.failed[0]).includes('names no sibling output $nowhere'))
})

test('an edge output lands on its link, and an answer that drops it deletes it', async () => {
  let reagents = {
    $defs: {
      needs: {
        component: true,
        type: 'object',
        edge: true,
        properties: { count: { type: 'number' } },
      },
    },
  }
  let items = ['x', 'y']
  let binding = answering(() => [
    ...items.map((to) => ({
      slot: to == 'y' ? 'needs y' : 'needs changing',
      inputs: [],
      components: { edge: { from: '$tome', to }, needs: { count: 2 } },
    })),
    { slot: 'tome', inputs: ['a'], components: { doc: { title: 'Tome' } } },
  ])
  let { g, runner, failed } = await shop({}, [reagents], [binding])
  let item = (eid: string): Bundle => ({
    entity: { eid },
    project: { name: eid },
  })
  await g.apply([item('x'), item('y'), item('z'), source('a'), builder()])
  let build = await runOf(g, ['a'])
  await drive(g, runner, build)
  assertEquals(failed, [])
  let tome = await outOf(g, build, 'tome')
  let needs = async () =>
    (await rows(g, `.edge.from=${tome}&.needs&.built.current=true`))
      .map((b) => b.entity.eid).toSorted()
  let linked = (...to: string[]) =>
    to.map((t) => edgeEid(tome, 'needs', t)).toSorted()
  assertEquals(await needs(), linked('x', 'y'))
  let [edge] = await g.get([edgeEid(tome, 'needs', 'x')])
  assertEquals(comp(edge, 'needs')?.count, 2)
  assertEquals(comp(edge, 'built')?.slot, 'needs changing')
  assertEquals(
    await outOf(g, build, 'needs changing'),
    edgeEid(tome, 'needs', 'x'),
  )
  assertEquals(await outOf(g, build, 'needs y'), edgeEid(tome, 'needs', 'y'))
  items = ['y', 'z']
  await g.apply([source('a', 'second')])
  assertEquals(await needs(), [])
  await drive(g, runner, build)
  // The tome is rewritten where it stands, and its links follow the answer.
  assertEquals(await outOf(g, build, 'tome'), tome)
  assertEquals(await needs(), linked('y', 'z'))
  assertEquals(failed, [])
  assertEquals(
    await outOf(g, build, 'needs changing'),
    edgeEid(tome, 'needs', 'z'),
  )
  assertEquals(await outOf(g, build, 'needs y'), edgeEid(tome, 'needs', 'y'))
  assert((await g.get([edgeEid(tome, 'needs', 'x')]))[0]?.tombstone)
  // A link between things the answer did not make is not the build's to state.
  let astray = answering([{
    slot: 'needs',
    inputs: [],
    components: { edge: { from: 'x', to: 'y' }, needs: { count: 1 } },
  }])
  let lost = await shop({}, [reagents], [astray])
  await lost.g.apply([item('x'), item('y'), source('a'), builder()])
  await drive(lost.g, lost.runner, await runOf(lost.g, ['a']))
  assert(String(lost.failed[0]).includes('joins nothing its answer made'))
})

test('a retained edge renamed to another slot retires only its former output key', async () => {
  let reagents = {
    $defs: { needs: { component: true, type: 'object', edge: true } },
  }
  let slot = 'old'
  let binding = answering(() => [
    { slot: 'tome', inputs: ['a'], components: { doc: { title: 'Tome' } } },
    {
      slot,
      inputs: [],
      components: { edge: { from: '$tome', to: 'x' }, needs: {} },
    },
    ...slot == 'old'
      ? [{
        slot: 'history',
        inputs: [],
        components: { doc: { title: 'Kept' } },
      }]
      : [],
  ])
  let { g, runner, failed } = await shop({}, [reagents], [binding])
  await g.apply([
    { entity: { eid: 'x' }, doc: { title: 'X' } },
    source('a'),
    builder(),
  ])
  let build = await runOf(g, ['a'])
  await drive(g, runner, build)
  let tome = await outOf(g, build, 'tome')
  let edge = edgeEid(tome, 'needs', 'x')
  let history = await outOf(g, build, 'history')
  assertEquals(await outOf(g, build, 'old'), edge)
  slot = 'new'
  await g.apply([source('a', 'second')])
  await drive(g, runner, build)
  assertEquals(failed, [])
  assertEquals(await outputFor(g, build, 'old'), undefined)
  let retired = await one(g, keyEid(OUTPUT_OF, outputOf(build, 'old')))
  assertEquals(comp(retired, 'key'), undefined)
  assertEquals(comp(retired, OUTPUT_OF), undefined)
  assertEquals(retired?.tombstone, undefined)
  assertEquals(await outOf(g, build, 'new'), edge)
  assertEquals(comp(await one(g, edge), 'built')?.slot, 'new')
  assertEquals(comp(await one(g, edge), 'edge')?.from, tome)
  assertEquals(comp(await one(g, edge), 'edge')?.to, 'x')
  assertEquals(await outOf(g, build, 'tome'), tome)
  assertEquals(await outOf(g, build, 'history'), history)
  assertEquals(comp(await one(g, history), 'doc')?.title, 'Kept')
  await g.apply([keyed(OUTPUT_OF, 'x', outputOf(build, 'old'))])
  assertEquals(await outOf(g, build, 'old'), 'x')
})

for (let legacy of ['old slot without a key', 'missing slot']) {
  test(`a retained legacy edge with ${legacy} expands to keyed outputs`, async () => {
    let reagents = {
      $defs: { needs: { component: true, type: 'object', edge: true } },
    }
    let slot = 'old'
    let outputs = () => [
      { slot: 'tome', inputs: ['a'], components: { doc: { title: 'Tome' } } },
      {
        slot,
        inputs: [],
        components: { edge: { from: '$tome', to: 'x' }, needs: {} },
      },
    ]
    let { g, runner, failed } = await shop({}, [reagents], [answering(outputs)])
    await g.apply([
      { entity: { eid: 'x' }, doc: { title: 'X' } },
      source('a'),
      builder(),
    ])
    let build = await runOf(g, ['a'])
    await drive(g, runner, build)
    let tome = await outOf(g, build, 'tome')
    let edge = await outOf(g, build, 'old')
    // Simulate outputs written before every output carried an output_of key.
    await g.apply([
      unkeyed(OUTPUT_OF, outputOf(build, 'old')),
      ...legacy == 'missing slot'
        ? [{ entity: { eid: edge }, built: { slot: null } }]
        : [],
    ])
    slot = 'new'
    await g.apply([source('a', 'second')])
    await drive(g, runner, build)
    assertEquals(failed, [])
    assertEquals(await outputFor(g, build, 'old'), undefined)
    assertEquals(await outOf(g, build, 'new'), edge)
    assertEquals(await outOf(g, build, 'tome'), tome)
    assertEquals(comp(await one(g, edge), 'built')?.slot, 'new')
    assertEquals(comp(await one(g, edge), 'edge')?.from, tome)
    assertEquals(comp(await one(g, edge), 'edge')?.to, 'x')
    for (let [name, eid] of [['tome', tome], ['new', edge]]) {
      let row = await one(g, keyEid(OUTPUT_OF, outputOf(build, name)))
      assertEquals(comp(row, 'key')?.of, eid)
      assertEquals(comp(row, OUTPUT_OF), {})
    }
    let old = await one(g, keyEid(OUTPUT_OF, outputOf(build, 'old')))
    assertEquals(old?.tombstone, undefined)
    assertEquals(comp(old, 'key'), undefined)
  })
}

test('renaming a retained edge with a conflicting old key owner refuses without writes', async () => {
  let reagents = {
    $defs: { needs: { component: true, type: 'object', edge: true } },
  }
  let slot = 'old'
  let outputs = () => [
    { slot: 'tome', inputs: ['a'], components: { doc: { title: slot } } },
    {
      slot,
      inputs: [],
      components: { edge: { from: '$tome', to: 'x' }, needs: {} },
    },
  ]
  let { g, runner, vocab, failed } = await shop({}, [reagents], [
    answering(outputs),
  ])
  await g.apply([
    { entity: { eid: 'x' }, doc: { title: 'X' } },
    source('a'),
    builder(),
  ])
  let build = await runOf(g, ['a'])
  await drive(g, runner, build)
  let tome = await outOf(g, build, 'tome')
  let edge = await outOf(g, build, 'old')
  let old = outputOf(build, 'old')
  await g.apply([unkeyed(OUTPUT_OF, old)])
  await g.apply([keyed(OUTPUT_OF, 'x', old)])
  slot = 'new'
  await g.apply([source('a', 'second')])
  let call = (await calls(g, build)).at(-1)!
  let snapshot = () =>
    g.get([
      build,
      call.entity.eid,
      tome,
      edge,
      keyEid(OUTPUT_OF, old),
      keyEid(OUTPUT_OF, outputOf(build, 'new')),
    ])
  let before = await snapshot()
  await assertRejects(
    () =>
      g.storage.tx((tx) =>
        answerWrites(tx, call, { outputs: outputs() }, vocab)
      ),
    Refused,
    "is x's",
  )
  assertEquals(await snapshot(), before)
  assertEquals(await outOf(g, build, 'old'), 'x')
  assertEquals(await outputFor(g, build, 'new'), undefined)
  assertEquals(comp(await one(g, edge), 'built')?.slot, 'old')
  assertEquals(comp(await one(g, tome), 'doc')?.title, 'old')
  assertEquals(failed, [])
})

test('swapping slots between retained edges refuses atomically', async () => {
  let reagents = {
    $defs: { needs: { component: true, type: 'object', edge: true } },
  }
  let swapped = false
  let outputs = () => [
    {
      slot: 'tome',
      inputs: ['a'],
      components: { doc: { title: swapped ? 'Changed' : 'Tome' } },
    },
    ...['x', 'y'].map((to, i) => ({
      slot: ['first', 'second'][swapped ? 1 - i : i],
      inputs: [],
      components: { edge: { from: '$tome', to }, needs: {} },
    })),
  ]
  let { g, runner, vocab, failed } = await shop({}, [reagents], [
    answering(outputs),
  ])
  await g.apply([
    ...['x', 'y'].map((eid) => ({ entity: { eid }, doc: { title: eid } })),
    source('a'),
    builder(),
  ])
  let build = await runOf(g, ['a'])
  await drive(g, runner, build)
  let tome = await outOf(g, build, 'tome')
  let x = edgeEid(tome, 'needs', 'x')
  let y = edgeEid(tome, 'needs', 'y')
  assertEquals(await outOf(g, build, 'first'), x)
  assertEquals(await outOf(g, build, 'second'), y)
  swapped = true
  await g.apply([source('a', 'second')])
  let call = (await calls(g, build)).at(-1)!
  let writes = await g.storage.tx((tx) =>
    answerWrites(tx, call, { outputs: outputs() }, vocab)
  )
  let snapshot = () =>
    g.get([
      build,
      call.entity.eid,
      tome,
      x,
      y,
      keyEid(OUTPUT_OF, outputOf(build, 'first')),
      keyEid(OUTPUT_OF, outputOf(build, 'second')),
    ])
  let before = await snapshot()
  await assertRejects(
    async () => {
      await g.apply(writes)
    },
    Refused,
    `is ${y}'s`,
  )
  assertEquals(await snapshot(), before)
  assertEquals(await outOf(g, build, 'first'), x)
  assertEquals(await outOf(g, build, 'second'), y)
  assertEquals(comp(await one(g, tome), 'doc')?.title, 'Tome')
  assertEquals(failed, [])
})

test('a query reads what was built for an entity', async () => {
  let { g, runner } = await shop({}, [], [code()])
  await g.apply([source('a'), source('b'), builder()])
  for (let s of ['a', 'b']) await drive(g, runner, await runOf(g, [s]))
  let eids = async (q: string) => (await rows(g, q)).map((b) => b.entity.eid)
  assertEquals(await eids('.build.for=a'), [await runOf(g, ['a'])])
  assertEquals(await eids('.built.build.build.for=b'), [
    await outOf(g, await runOf(g, ['b'])),
  ])
})

test('a code tool can return an artifact output without owning built rows', async () => {
  let artifact = 'a-artifact'
  let media: Tool = {
    ...code(),
    run: (call) => [{
      entity: { eid: artifact },
      artifact: { address: 'sha256:abc', media_type: 'image/png', size: 3 },
    }, {
      entity: { eid: crypto.randomUUID() },
      output: {
        source: call.entity.eid,
        value: {
          outputs: [{
            slot: 'icon',
            inputs: ['a'],
            components: {},
            artifact,
          }],
        },
      },
    }],
  }
  let { g, runner } = await shop({}, [], [media])
  await g.apply([source('a'), builder()])
  let build = await runOf(g, ['a'])
  await drive(g, runner, build)
  let built = comp(await one(g, await outOf(g, build, 'icon')), 'built')
  assertEquals(built?.artifact, artifact)
  assertEquals(built?.media_type, undefined)
  assert(
    (await one(g, edgeEid(await outOf(g, build, 'icon'), 'cites', 'a')))?.cites,
  )
})

test('tool revision and input content change a key once each', async () => {
  let { g } = await shop({}, [], [code()])
  await g.apply([source('a'), builder()])
  let build = await runOf(g, ['a'])
  let first = comp(await one(g, build), 'build')?.key
  await g.apply([source('a')])
  assertEquals(comp(await one(g, build), 'build')?.key, first)
  await g.apply([source('a', 'second')])
  let second = comp(await one(g, build), 'build')?.key
  assertNotEquals(second, first)
  await g.apply([{ entity: { eid: toolEid('code') }, tool: { revision: '2' } }])
  assertNotEquals(comp(await one(g, build), 'build')?.key, second)
})

test('selected content, definition edits and removed matches reconcile', async () => {
  let { g } = await shop({}, [], [code()])
  await g.apply([source('a'), source('b'), builder()])
  let a = await runOf(g, ['a'])
  let first = comp(await one(g, a), 'build')?.key
  await g.apply([{ entity: { eid: 'a' }, project: { name: 'new content' } }])
  assertNotEquals(comp(await one(g, a), 'build')?.key, first)
  await g.apply([{
    entity: { eid: ids.builder },
    builder: {
      query: '.doc.title=Elsewhere',
    },
  }])
  assertEquals(comp(await one(g, a), 'build')?.stale, true)
  await g.apply([{ entity: { eid: 'b' }, doc: { title: 'Elsewhere' } }])
  assertEquals(
    comp(await one(g, await runOf(g, ['b'])), 'build')?.stale,
    false,
  )
  await g.apply([{ entity: { eid: 'b' }, doc: null }])
  assertEquals(
    comp(await one(g, await runOf(g, ['b'])), 'build')?.stale,
    true,
  )
})

test('unrelated changes read a bounded number of rows with many builders', async () => {
  let { g, failed } = await shop({}, [], [code()])
  let many = Array.from({ length: 32 }, (_, i): Bundle => ({
    entity: { eid: `builder-${i}` },
    builder: {
      query: `.doc.title=Target-${i}`,
      to: toolEid('code'),
      immediate: true,
    },
  }))
  await g.apply(many)
  let read = g.storage.read
  let count = 0
  g.storage.read = (query, opts, comps) =>
    Promise.resolve(read(query, opts, comps)).then((found) => {
      count += found.length
      return found
    })
  await g.apply([{ entity: { eid: 'unrelated' }, project: { name: 'Other' } }])
  assertEquals(failed, [])
  assert(count < 8, `${count} rows read for 32 unrelated builders`)
  console.log(`32 builders, unrelated graph change: ${count} rows read`)
})

test('an authored using value and its admitted form have one key', async () => {
  let { g, vocab } = await shop({}, [], [code()])
  let authored = { ...builder(), using: { model: ids.model } }
  await g.apply([source('a'), authored])
  let stored = await one(g, ids.builder)
  let [tool] = await g.get([toolEid('code')])
  let [{ binding, rows }] = await g.storage.tx((tx) =>
    selected(tx, stored, vocab)
  )
  assertEquals(
    key(authored, tool, binding, rows, vocab),
    key(stored, tool, binding, rows, vocab),
  )
})

test('a malformed output cannot write and leaves its build retryable', async () => {
  let bad: Tool = {
    ...code(),
    run: (call) => [{
      entity: { eid: crypto.randomUUID() },
      output: {
        source: call.entity.eid,
        value: {
          outputs: [{
            slot: 'bad',
            inputs: ['outside'],
            components: {},
          }],
        },
      },
    }],
  }
  let { g, runner, failed } = await shop({}, [], [bad])
  await g.apply([source('a'), builder()])
  let build = await runOf(g, ['a'])
  await drive(g, runner, build)
  assertEquals((await rows(g, '.built')).length, 0)
  assertEquals(comp(await one(g, build), 'build')?.key, null)
  assert(failed.length > 0)
})

test('a model reply cut short leaves its build to be asked again', async () => {
  let { g, runner, failed } = await shop()
  await g.apply([source('a'), {
    ...builder('$s .doc.title=Source', toolEid('builder_model')),
    using: { model: ids.model },
  }])
  let build = await runOf(g, ['a'])
  await drive(g, runner, build)
  let [session] = await rows(g, '.session')
  let s = session.entity.eid
  await g.apply([
    asked(s, 2, 'ask-1', 'completed'),
    replied(s, 3, 'ask-1', '{"outputs": [{"slot": "main", "inputs": ["a"]'),
  ])
  assertEquals((await rows(g, '.built')).length, 0)
  assertEquals(comp(await one(g, build), 'build')?.key, null)
  assert(failed.length > 0)
})

test('shadow builds have distinct ids and cannot feed another builder', async () => {
  let { g, runner, vocab } = await shop({}, [], [code()])
  await g.apply([source('a'), builder()])
  let primary = await runOf(g, ['a'])
  await drive(g, runner, primary)
  let [said] = await asking(g, vocab)({ template: 'alternate' })
  assert(said.content)
  let shadow = (await rows(g, '.build')).find((b) =>
    comp(b, 'build')?.variant != 'main'
  )!
  await drive(g, runner, shadow.entity.eid)
  assertNotEquals(await outOf(g, shadow.entity.eid), await outOf(g, primary))
  let downstream: Bundle = {
    entity: { eid: 'downstream' },
    builder: {
      query: '$s .doc.title=Source; [$x .built]',
      to: toolEid('code'),
      immediate: true,
    },
  }
  await g.apply([downstream])
  assertEquals((await rows(g, '.build.builder=downstream')).length, 1)
  let [asked] = await calls(g, await runOf(g, ['a'], 'main', 'downstream'))
  let binding = (comp(asked, 'call')?.args as {
    binding: { collections: { members: { entities: string[] }[] }[] }
  }).binding
  assertEquals(binding.collections[0].members.map((row) => row.entities[0]), [
    await outOf(g, primary),
  ])
})

test('an archived builder builds by no door until the mark is removed', async () => {
  let { g, vocab } = await shop({}, [marksDoc], [code()])
  let ask = asking(g, vocab)
  let built = async () => (await rows(g, '.build')).length
  await g.apply([source('a'), { ...builder(), archived: {} }])
  await g.apply([source('b')])
  await g.apply([ring])
  assertEquals(await built(), 0)
  await assertRejects(() => ask(), CallError, 'is archived')
  await g.apply([{ entity: { eid: ids.builder }, archived: null }])
  await ask()
  assertEquals(await built(), 2)
})

test('a staged builder is built on no create, edit, wake or input change', async () => {
  let { g, vocab } = await shop({}, [], [code()])
  let ask = asking(g, vocab)
  await g.apply([source('a'), { ...builder(), staged: {} }])
  await g.apply([{ entity: { eid: ids.builder }, content: { body: 'Again' } }])
  await g.apply([ring])
  assertEquals(await built(g), [])
  // `builder build` still builds it, and its inputs are then known, so a
  // change to one is a change the builder would otherwise answer.
  await ask()
  let key = await keyOf(g, 'a')
  await g.apply([source('a', 'second'), source('b')])
  assertEquals(await keyOf(g, 'a'), key)
  assertEquals(await built(g), ['a'])
})

test('a partial build makes the named bindings and leaves the others current', async () => {
  let { g, runner, vocab } = await shop({}, [], [code()])
  let ask = asking(g, vocab)
  await g.apply([source('a'), source('b'), source('c'), builder()])
  for (let s of ['a', 'b', 'c']) await drive(g, runner, await runOf(g, [s]))
  await g.apply([{ entity: { eid: ids.builder }, staged: {} }])
  await g.apply([{ entity: { eid: ids.builder }, content: { body: 'Again' } }])
  await ask({ only: ['a'] })
  await drive(g, runner, await runOf(g, ['a']))
  for (let s of ['a', 'b', 'c']) {
    assertEquals(await staleOf(g, s), false)
    assertEquals(await currentOf(g, s), true)
    assertEquals(
      (await calls(g, await runOf(g, [s]))).length,
      s == 'a' ? 2 : 1,
    )
  }
  // A shadow template tried on one binding leaves every main build alone.
  await ask({ only: ['b'], template: 'Shadow $s' })
  let shadows = (await rows(g, '.build&.build.variant!=main')).map(match)
  assertEquals(shadows, [['b']])
  assertEquals(await currentOf(g, 'a'), true)
  // A name in no binding is said, not quietly skipped.
  await g.apply([{ entity: { eid: 'x' }, doc: { title: 'Elsewhere' } }])
  await assertRejects(() => ask({ only: ['x'] }), CallError, 'in no binding')
})

test('removing the staged mark builds the rest and asks no sampled binding again', async () => {
  let { g, runner, vocab } = await shop({}, [], [code()])
  let ask = asking(g, vocab)
  await g.apply([source('a'), source('b'), source('c'), {
    ...builder(),
    staged: {},
  }])
  await ask({ limit: 2 })
  let [sampled] = await built(g)
  assertEquals((await built(g)).length, 2)
  await drive(g, runner, await runOf(g, [sampled]))
  await g.apply([{ entity: { eid: ids.builder }, staged: null }])
  assertEquals(await built(g), ['a', 'b', 'c'])
  for (let s of ['a', 'b', 'c']) {
    assertEquals((await calls(g, await runOf(g, [s]))).length, 1)
  }
  assertEquals(await currentOf(g, sampled), true)
})

test('a model turn failed for good leaves its key retryable without another call', async () => {
  let { g, runner } = await shop()
  await g.apply([source('a'), {
    ...builder('$s .doc.title=Source', toolEid('builder_model')),
    using: { model: ids.model },
  }])
  let build = await runOf(g, ['a'])
  await drive(g, runner, build)
  let [session] = await rows(g, '.session')
  let failed = (seq: number, code: string): Bundle => ({
    entity: { eid: crypto.randomUUID() },
    entry: { session: session.entity.eid, seq },
    content: { body: 'Connection unavailable' },
    error: { code },
  })
  // A request the runner asks again is not the end of the turn.
  await g.apply([failed(2, 'connection')])
  assert(comp(await one(g, build), 'build')?.key)
  await g.apply([failed(3, 'limit')])
  assertEquals(comp(await one(g, build), 'build')?.key, null)
  assertEquals((await calls(g, build)).length, 1)
})

test('model tool opens a session using content.body, then adapts its reply', async () => {
  let { g, runner, failed } = await shop()
  await g.apply([source('a'), {
    ...builder(
      '$s .doc.title=Source, doc.body=$description',
      toolEid('builder_model'),
    ),
    content: { body: 'Build $s: $description' },
    doc: { body: 'Documentation, not a request.' },
    using: { model: ids.model, effort: 'low' },
  }])
  let build = await runOf(g, ['a'])
  await drive(g, runner, build)
  let [session] = await rows(g, '.session')
  let [entry] = await rows(g, `.entry.session=${session.entity.eid}`)
  let prompt = String(comp(entry, 'content')?.body)
  assert(prompt.includes('Build a: first'))
  assert(!prompt.includes('Documentation'))
  assertEquals(comp(entry, 'using')?.effort, 'low')
  let answer = JSON.stringify({
    outputs: [{
      slot: 'main',
      inputs: ['a'],
      components: { doc: { body: 'From model' } },
    }],
  })
  // A streamed reply is written as it arrives: half of it is no answer yet.
  await g.apply([
    asked(session.entity.eid, 2, 'model-answer', 'inflight'),
    replied(
      session.entity.eid,
      3,
      'model-answer',
      answer.slice(0, 20),
      'reply',
    ),
  ])
  assertEquals(await outputFor(g, build), undefined)
  await g.apply([
    asked(session.entity.eid, 2, 'model-answer', 'completed'),
    replied(session.entity.eid, 3, 'model-answer', answer, 'reply'),
  ])
  assertEquals(failed, [])
  assertEquals(
    comp(await one(g, await outOf(g, build)), 'doc')?.body,
    'From model',
  )
})

test('prose a model writes beside a tool call is not its answer', async () => {
  let { g, runner, failed } = await shop()
  await g.apply([source('a'), {
    ...builder('$s .doc.title=Source', toolEid('builder_model')),
    using: { model: ids.model },
  }])
  let build = await runOf(g, ['a'])
  await drive(g, runner, build)
  let [session] = await rows(g, '.session')
  let s = session.entity.eid
  await g.apply([
    asked(s, 2, 'ask-1', 'completed'),
    replied(s, 3, 'ask-1', 'Let me read around it first.'),
    {
      entity: { eid: 'look' },
      entry: { session: s, seq: 4 },
      call: { to: toolEid('code'), source: 'ask-1' },
    },
  ])
  let answer = { slot: 'main', inputs: ['a'], components: { doc: {} } }
  await g.apply([
    asked(s, 5, 'ask-2', 'completed'),
    replied(s, 6, 'ask-2', JSON.stringify({ outputs: [answer] })),
  ])
  assertEquals(failed, [])
  assert(await one(g, await outOf(g, build)))
})

test("a build's cost sums what its calls said and its sessions spent", async () => {
  let paid: Tool = {
    ...code(),
    run: (call) => {
      let [said] = answer(call)
      let value = (said.output as Comp).value as Comp
      return [{
        ...said,
        output: { ...said.output as Comp, value: { ...value, cost: 0.25 } },
      }]
    },
  }
  let { g, runner } = await shop({}, [], [paid])
  let cost = async (build: string) => comp(await one(g, build), 'build')?.cost
  await g.apply([source('a'), builder()])
  let build = await runOf(g, ['a'])
  assertEquals(await cost(build), null)
  await drive(g, runner, build)
  let [asked] = await calls(g, build)
  assertEquals(comp(await one(g, asked.entity.eid), 'cost'), {
    dollars: 0.25,
    reported: true,
  })
  await g.apply([source('a', 'second')])
  await drive(g, runner, build)
  assertEquals(await cost(build), 0.5)

  let { g: m, runner: r } = await shop()
  await m.apply([source('a'), {
    ...builder('$s .doc.title=Source', toolEid('builder_model')),
    using: { model: ids.model },
  }])
  let modeled = await runOf(m, ['a'])
  await drive(m, r, modeled)
  let [session] = await rows(m, '.session')
  await m.apply([{
    entity: { eid: crypto.randomUUID() },
    entry: { session: session.entity.eid, seq: 2 },
    ask: { to: ids.model },
    usage: { input_tokens: 10 },
    cost: { dollars: 0.125, reported: true },
  }])
  assertEquals(comp(await one(m, modeled), 'build')?.cost, 0.125)
})

test('a model builder renders an empty selected collection in its prompt', async () => {
  let { g, runner, failed } = await shop()
  await g.apply([source('a'), {
    ...builder(
      '$s .doc.title=Source; [$p .doc.title=Point, .doc.body=$body]',
      toolEid('builder_model'),
    ),
    content: { body: 'Subject $s:\n$p\nBodies $body' },
    using: { model: ids.model },
  }])
  await drive(g, runner, await runOf(g, ['a']))
  let [session] = await rows(g, '.session')
  assertEquals(failed, [])
  assert(session)
  let [entry] = await rows(g, `.entry.session=${session.entity.eid}`)
  assert(
    String(comp(entry, 'content')?.body).startsWith(
      'Subject a:\n[]\nBodies []\n\nInputs: a\n',
    ),
  )
})

test('template substitution reads variables in nested bindings', () => {
  assertEquals(
    render('$s: $n and $$', {
      entities: ['a'],
      vars: { s: 'a' },
      collections: [{
        vars: ['n'],
        entityVars: ['n'],
        members: [{ entities: ['n1'], vars: { n: 'note' } }],
      }],
    }),
    'a: note and $',
  )
})

test('a bracket member variable says each member whole', () => {
  let note = (eid: string, body: string) => ({
    entities: [eid],
    vars: { s: 'a', n: eid, body },
  })
  assertEquals(
    JSON.parse(render('$n', {
      entities: ['a'],
      vars: { s: 'a' },
      collections: [{
        vars: ['n', 'body'],
        entityVars: ['n'],
        members: [note('n1', 'same'), note('n2', 'same')],
      }],
    })),
    [{ n: 'n1', body: 'same' }, { n: 'n2', body: 'same' }],
  )
})

test('an empty bracket member variable renders as an empty list', () => {
  assertEquals(
    render('$p', {
      entities: ['a'],
      vars: { s: 'a' },
      collections: [{ vars: ['p'], entityVars: ['p'], members: [] }],
    }),
    '[]',
  )
  assertThrows(
    () =>
      render('$missing', {
        entities: ['a'],
        vars: { s: 'a' },
        collections: [{ vars: ['p'], entityVars: ['p'], members: [] }],
      }),
    Error,
    'builder template has no $missing binding',
  )
})

test('a downstream builder selects only current outputs', async () => {
  let { g, runner, vocab } = await shop({}, [], [code()])
  await g.apply([source('a'), builder()])
  let build = await runOf(g, ['a'])
  await drive(g, runner, build)
  let now = async () =>
    (await g.storage.tx((tx) =>
      selected(tx, {
        entity: { eid: 'downstream' },
        builder: { query: '$o .built.current=true' },
      }, vocab)
    )).map(({ binding }) => binding.entities[0])
  assertEquals(await now(), [await outOf(g, build)])
  await g.apply([source('a', 'second')])
  assertEquals(await now(), [])
  await drive(g, runner, build)
  assertEquals(await now(), [await outOf(g, build)])
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'Elsewhere' } }])
  assertEquals(await now(), [])
})

test('model builder instruction prefix is shared across bindings and appended once', async () => {
  let { g } = await shop()
  let tool = modelTool()
  let invoke = (id: string, using: Comp) => {
    let call: Bundle = {
      entity: { eid: 'call-' + id },
      call: {
        args: {
          binding: { entities: [id], vars: { source: id } },
          template: 'Summarize $source',
          using,
        },
      },
    }
    let rows = tool.run(call, g)
    assert(Array.isArray(rows))
    return rows.find((b) => b.entry)!
  }
  let using = {
    model: ids.model,
    effort: 'low',
    instructions: 'Base instruction',
  }
  let a = invoke('a', using), b = invoke('b', using)
  assertEquals(a.using, b.using)
  let fixed = String(comp(a, 'using')?.instructions)
  assert(fixed.startsWith('Base instruction\n\n'))
  assert(fixed.includes('Answer with JSON:'))
  assert(fixed.includes('Cite only selected input ids.'))
  assertEquals(comp(a, 'content')?.body, 'Summarize a\n\nInputs: a\n')
  assertEquals(comp(b, 'content')?.body, 'Summarize b\n\nInputs: b\n')
  assertEquals(comp(invoke('c', comp(a, 'using')!), 'using'), a.using)
  let none = invoke('d', { model: ids.model })
  assert(
    String(comp(none, 'using')?.instructions).startsWith('Answer with JSON:'),
  )
  assertEquals(using.instructions, 'Base instruction')
})

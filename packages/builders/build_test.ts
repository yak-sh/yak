import { test } from '@yaks/testing'
import { assert, assertEquals, assertNotEquals } from '@std/assert'
import type { Bundle, Comp, Graph, Tool } from '@yaks/graph'
import { edgeEid } from '@yaks/edge'
import { toolEid } from '@yaks/tools'
import { ids, shop } from './testing.ts'
import { current, output, run, selected } from './build.ts'
import { key } from './key.ts'
import { render } from './model.ts'
import { runs } from './tools.ts'

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined
let rows = async (g: Graph, q: string) => await g.read(`${q}&*`)
let one = async (g: Graph, eid: string) => (await g.get([eid]))[0]
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
let calls = (g: Graph, build: string) => rows(g, `.call.source=${build}`)
let drive = async (
  g: Graph,
  r: Awaited<ReturnType<typeof shop>>['runner'],
  build: string,
) => {
  let pending = await calls(g, build)
  await r.due(pending.at(-1)!.entity.eid)
}

test('outer query bindings make independent builds and tool calls', async () => {
  let { g, runner } = await shop({}, [], [code()])
  await g.apply([source('a'), source('b'), builder()])
  let a = run(ids.builder, ['a'])
  let b = run(ids.builder, ['b'])
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
  assertEquals(comp(await one(g, output(a)), 'doc')?.body, 'Made')
  assertEquals(comp(await one(g, output(b)), 'built')?.build, b)
  let cited = await one(g, edgeEid(output(a), 'cites', 'a'))
  assert(cited?.cites)
})

test('nested collection changes the key but retains the build and output', async () => {
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
  let { g, runner } = await shop({}, [notes], [code()])
  let query = '$s .doc.title=Source; [$n .note.parent=$s]'
  await g.apply([source('a'), builder(query)])
  let build = run(ids.builder, ['a'])
  let before = comp(await one(g, build), 'build')?.key
  await drive(g, runner, build)
  await g.apply([{ entity: { eid: 'n1' }, note: { parent: 'a', text: 'one' } }])
  assertEquals((await rows(g, '.build')).length, 1)
  assertNotEquals(comp(await one(g, build), 'build')?.key, before)
  assertEquals((await calls(g, build)).length, 2)
  await drive(g, runner, build)
  assertEquals((await rows(g, '.built')).length, 1)
  assertEquals(
    comp(await one(g, output(build)), 'built')?.key,
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
  let build = run(ids.builder, ['a'])
  await drive(g, runner, build)
  let made = output(build)
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
  let build = run(ids.builder, ['a'])
  await drive(g, runner, build)
  let built = comp(await one(g, output(build, 'icon')), 'built')
  assertEquals(built?.artifact, artifact)
  assertEquals(built?.media_type, undefined)
  assert((await one(g, edgeEid(output(build, 'icon'), 'cites', 'a')))?.cites)
})

test('tool revision and input content change a key once each', async () => {
  let { g } = await shop({}, [], [code()])
  await g.apply([source('a'), builder()])
  let build = run(ids.builder, ['a'])
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
  let a = run(ids.builder, ['a'])
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
    comp(await one(g, run(ids.builder, ['b'])), 'build')?.stale,
    false,
  )
  await g.apply([{ entity: { eid: 'b' }, doc: null }])
  assertEquals(
    comp(await one(g, run(ids.builder, ['b'])), 'build')?.stale,
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
  let build = run(ids.builder, ['a'])
  await drive(g, runner, build)
  assertEquals((await rows(g, '.built')).length, 0)
  assertEquals(comp(await one(g, build), 'build')?.key, null)
  assert(failed.length > 0)
})

test('shadow builds have distinct ids and cannot feed another builder', async () => {
  let { g, runner, vocab } = await shop({}, [], [code()])
  await g.apply([source('a'), builder()])
  let primary = run(ids.builder, ['a'])
  await drive(g, runner, primary)
  let [said] = await runs({ vocab }).builder_build(
    {
      entity: { eid: 'ask' },
      call: {
        args: {
          builder: ids.builder,
          template: 'alternate',
        },
      },
    },
    g,
  )
  assert(said.content)
  let shadow = (await rows(g, '.build')).find((b) =>
    comp(b, 'build')?.variant != 'main'
  )!
  await drive(g, runner, shadow.entity.eid)
  assertNotEquals(output(shadow.entity.eid), output(primary))
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
  let [asked] = await calls(g, run('downstream', ['a']))
  let binding = (comp(asked, 'call')?.args as {
    binding: { collections: { entities: string[] }[][] }
  }).binding
  assertEquals(binding.collections[0].map((row) => row.entities[0]), [
    output(primary),
  ])
})

test('a failed model turn leaves its key retryable without another call', async () => {
  let { g, runner } = await shop()
  await g.apply([source('a'), {
    ...builder('$s .doc.title=Source', toolEid('builder_model')),
    using: { model: ids.model },
  }])
  let build = run(ids.builder, ['a'])
  await drive(g, runner, build)
  let [session] = await rows(g, '.session')
  await g.apply([{
    entity: { eid: crypto.randomUUID() },
    entry: { session: session.entity.eid, seq: 2 },
    content: { body: 'Connection unavailable' },
    error: { code: 'connection' },
  }])
  assertEquals(comp(await one(g, build), 'build')?.key, null)
  assertEquals((await calls(g, build)).length, 1)
})

test('model tool opens a session using content.body, then adapts its reply', async () => {
  let { g, runner } = await shop()
  await g.apply([source('a'), {
    ...builder(
      '$s .doc.title=Source, doc.body=$description',
      toolEid('builder_model'),
    ),
    content: { body: 'Build $s: $description' },
    doc: { body: 'Documentation, not a request.' },
    using: { model: ids.model, effort: 'low' },
  }])
  let build = run(ids.builder, ['a'])
  await drive(g, runner, build)
  let [session] = await rows(g, '.session')
  let [entry] = await rows(g, `.entry.session=${session.entity.eid}`)
  let prompt = String(comp(entry, 'content')?.body)
  assert(prompt.includes('Build a: first'))
  assert(!prompt.includes('Documentation'))
  assertEquals(comp(entry, 'using')?.effort, 'low')
  await g.apply([{
    entity: { eid: crypto.randomUUID() },
    entry: { session: session.entity.eid, seq: 2 },
    content: {
      body: JSON.stringify({
        outputs: [{
          slot: 'main',
          inputs: ['a'],
          components: { doc: { body: 'From model' } },
        }],
      }),
    },
    output: { source: 'model-answer' },
  }])
  assertEquals(comp(await one(g, output(build)), 'doc')?.body, 'From model')
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
  let build = run(ids.builder, ['a'])
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
  let modeled = run(ids.builder, ['a'])
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

test('template substitution reads variables in nested bindings', () => {
  assertEquals(
    render('$s: $n and $$', {
      entities: ['a'],
      vars: { s: 'a' },
      collections: [[{ entities: ['n1'], vars: { n: 'note' } }]],
    }),
    'a: note and $',
  )
})

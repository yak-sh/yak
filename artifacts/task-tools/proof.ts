/// <reference lib="deno.ns" />
// Atomic edits and relationships through the same MCP door clients use.
let cases: [string, () => void | Promise<void>][] = []
let test = (name: string, run: () => void | Promise<void>) => {
  cases.push([name, run])
}
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from 'jsr:@std/assert@^1.0.0'
import { type Bundle, graph } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { edgeDoc, edgeEid, edgeKeywords, edges } from '@yaks/edge'
import { toolsDoc } from '@yaks/tools'
import { argsFor } from '../../packages/cli/args.ts'
import { core } from '../../packages/mcp/tools.ts'
import { connect, result, text } from '../../packages/mcp/testing.ts'

let vocab = loadVocab([edgeDoc, toolsDoc, {
  $defs: {
    entity: { component: true, type: 'object', wire: false, properties: {} },
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    task: { component: true, type: 'object', properties: {} },
    filed: {
      component: true,
      type: 'object',
      properties: { priority: { type: 'number' } },
    },
    blocked: { component: true, type: 'object', properties: {} },
    requires: {
      component: true,
      type: 'object',
      edge: true,
      properties: { reason: { type: 'string' } },
    },
  },
}], [edgeKeywords])

let fixture = async () => {
  let g = graph({ storage: ram(vocab), vocab, plugins: [edges(vocab)] })
  let a = crypto.randomUUID(), b = crypto.randomUUID()
  await g.apply([
    {
      entity: { eid: a },
      task: {},
      doc: { title: 'First', body: 'one two two' },
      filed: { priority: 3 },
      blocked: {},
    },
    { entity: { eid: b }, task: {}, content: { body: 'Second' } },
  ])
  let client = await connect({ graph: g })
  let apply = (args: Record<string, unknown>) =>
    client.callTool({ name: 'graph_apply', arguments: args })
  return { g, a, b, client, apply }
}

let fields = await fixture()
test('MCP edits fields, literal text and ordered relationships atomically', async () => {
  let { a, b, g, apply } = fields
  let out = await apply({
    edits: [{
      id: a,
      set: { 'doc.title': 'Changed', 'filed.priority': null, blocked: null },
      text: [{ path: 'doc.body', find: 'two', replace: '$&', all: true }],
    }, {
      id: b,
      text: [{ path: 'content.body', prepend: 'Before ', append: ' after' }],
    }],
    links: [{
      from: a,
      relation: 'requires',
      to: b,
      ord: 2,
      props: { reason: 'Wait' },
    }],
  })
  assert(!out.isError, text(out))
  let [first, second, edge] = await g.get([a, b, edgeEid(a, 'requires', b)])
  assertEquals(first.doc, { title: 'Changed', body: 'one $& $&' })
  assertEquals(first.filed, {})
  assertEquals(first.blocked, undefined)
  assertEquals(second.content, { body: 'Before Second after' })
  assertEquals(edge.edge, { from: a, to: b, ord: 2 })
  assertEquals(edge.requires, { reason: 'Wait' })
})

let creates = await fixture()
test('MCP compact edits create and connect local aliases in one call', async () => {
  let out = await creates.apply({
    edits: [
      { id: '$parent', set: { task: {}, 'doc.title': 'Parent' } },
      { id: '$child', set: { task: {}, 'doc.title': 'Child' } },
    ],
    links: [{ from: '$parent', relation: 'requires', to: '$child' }],
  })
  assert(!out.isError, text(out))
  let rows = result(out) as Bundle[]
  let parent = rows.find((b) => b.$alias == '$parent')!
  let child = rows.find((b) => b.$alias == '$child')!
  let [link] = await creates.g.get([
    edgeEid(parent.entity.eid, 'requires', child.entity.eid),
  ])
  assertEquals(link.edge, { from: parent.entity.eid, to: child.entity.eid })
})

let stale = await fixture()
test('MCP stale text leaves companion fields and links unchanged', async () => {
  let { g, a, b, apply } = stale
  let out = await apply({
    edits: [{
      id: a,
      set: { 'doc.title': 'Lost' },
      text: [{ path: 'doc.body', append: ' later', was: token('an old read') }],
    }],
    links: [{ from: a, relation: 'requires', to: b }],
  })
  assert(out.isError)
  assertStringIncludes(text(out), 'doc.body')
  assertEquals((await g.get([a]))[0].doc, {
    title: 'First',
    body: 'one two two',
  })
  assertEquals(await g.get([edgeEid(a, 'requires', b)]), [])
})

let race = await fixture()
test('MCP text guards a change arriving between its read and commit', async () => {
  let { g, a, b, apply } = race
  let get = g.get.bind(g)
  let moved = false
  g.get = async (ids, comps) => {
    let rows = await get(ids, comps)
    if (!moved && ids.length == 1 && ids[0] == a) {
      moved = true
      await g.apply([{ entity: { eid: a }, doc: { body: 'Concurrent' } }])
    }
    return rows
  }
  try {
    let out = await apply({
      edits: [{
        id: a,
        set: { 'doc.title': 'Lost' },
        text: [{ path: 'doc.body', append: ' later' }],
      }],
      links: [{ from: a, relation: 'requires', to: b }],
    })
    assert(out.isError)
    assert(moved)
    assertEquals((await get([a]))[0].doc, {
      title: 'First',
      body: 'Concurrent',
    })
    assertEquals(await get([edgeEid(a, 'requires', b)]), [])
  } finally {
    g.get = get
  }
})

let drop = await fixture()
await drop.apply({
  links: [{ from: drop.a, relation: 'requires', to: drop.b }],
})
test('MCP compact links can be removed and added again', async () => {
  let { g, a, b, apply } = drop
  let out = await apply({
    links: [{ from: a, relation: 'requires', to: b, drop: true }],
  })
  assert(!out.isError, text(out))
  assertEquals(await g.read('.requires'), [])
  assertEquals((await g.get([edgeEid(a, 'requires', b)]))[0].tombstone, {})
  assert(
    !(await apply({ links: [{ from: a, relation: 'requires', to: b }] }))
      .isError,
  )
  assertEquals((await g.read('.requires')).length, 1)
})

let check = await fixture()
test('MCP rehearses compact edits and deletion without keeping them', async () => {
  let { a, g, apply } = check
  assert(!(await apply({ id: a, text: 'Replacement', check: true })).isError)
  assertEquals((await g.get([a]))[0].doc, {
    title: 'First',
    body: 'one two two',
  })
  assert(
    !(await apply({ edits: [{ id: a, delete: true }], check: true })).isError,
  )
  assertEquals((await g.get([a]))[0].task, {})
  assert(!(await apply({ edits: [{ id: a, delete: true }] })).isError)
  assertEquals((await g.get([a]))[0].tombstone, {})
})

let cli = await fixture()
let grammar = core({ vocab }).find((tool) => tool.name == 'graph_apply')!
test('CLI file text and compact flags call the same MCP operation', async () => {
  let { a, b, g, apply } = cli
  let args = await argsFor(grammar, [
    '--id',
    b,
    '--path',
    'content.body',
    '--text',
    '@body.md',
    '--edits',
    JSON.stringify({ id: a, set: { 'doc.title': 'From CLI' } }),
    '--links',
    JSON.stringify({ from: a, relation: 'requires', to: b }),
  ], { file: () => 'Body from file', stdin: () => '' })
  let out = await apply(args)
  assert(!out.isError, text(out))
  let [first, second] = await g.get([a, b])
  assertEquals(first.doc, { title: 'From CLI', body: 'one two two' })
  assertEquals(second.content, { body: 'Body from file' })
  assertEquals((await g.read('.requires')).length, 1)
})

let sequence = await fixture()
test('MCP resolves local aliases before a link is added and removed', async () => {
  let out = await sequence.apply({
    edits: [{ id: '$a', set: { task: {} } }, { id: '$b', set: { task: {} } }],
    links: [
      { from: '$a', relation: 'requires', to: '$b' },
      { from: '$a', relation: 'requires', to: '$b', drop: true },
    ],
  })
  assert(!out.isError, text(out))
  assertEquals(await sequence.g.read('.requires'), [])
})

let reset = await fixture()
test('MCP component removal and new text discard all previous fields', async () => {
  let out = await reset.apply({
    edits: [{
      id: reset.a,
      set: { doc: null },
      text: [{ path: 'doc.body', append: 'New' }],
    }],
  })
  assert(!out.isError, text(out))
  assertEquals((await reset.g.get([reset.a]))[0].doc, { body: 'New' })
})

test('MCP never discards an earlier read precondition', async () => {
  let out = await stale.apply({
    edits: [
      {
        id: stale.a,
        was: { 'doc.body': token('old') },
        text: [{ path: 'doc.body', append: ' one' }],
      },
      {
        id: stale.a,
        text: [{ path: 'doc.body', append: ' two', was: token('one two two') }],
      },
    ],
  })
  assert(out.isError)
  assertStringIncludes(text(out), 'conflicting was')
  assertEquals((await stale.g.get([stale.a]))[0].doc, {
    title: 'First',
    body: 'one two two',
  })
})

for (let [name, run] of cases) {
  await run()
  console.log(name)
}
for (
  let fixture of [
    fields,
    creates,
    stale,
    race,
    drop,
    check,
    cli,
    sequence,
    reset,
  ]
) {
  await fixture.client.close()
}
console.log(`Passed ${cases.length} MCP proofs`)

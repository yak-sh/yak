// SQL-state-only derived gets share the existing bounded answer pool. Every
// mutation ends that proof, including writes to other owners in the same tx.
import { equal, ok, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { sessionDoc } from '@yaks/session'
import { sessionDerived } from '../session/status.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc } from '@yaks/model/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { fn, lit } from '@yaks/sql'
import { storage } from './mod.ts'
import { open } from './db.ts'

let vocab = loadVocab([
  kernelDoc,
  sessionDoc,
  modelDoc,
  toolsDoc,
  archetypeDoc,
  {
    $defs: {
      doc: { component: true, properties: { title: { type: 'string' } } },
    },
  },
], [kernelKeywords])
let fixture = (path = ':memory:', overrides = {}) => {
  let d = open(path)
  let s = storage(d, vocab, {
    derived: { ...sessionDerived(vocab), ...overrides },
  })
  s.install()
  let g = graph({ storage: s, vocab, plugins: [archetypes()] })
  let query = d.query, n = 0
  d.query = (stmt) => {
    if (stmt.t == 'select' || stmt.t == 'raw') n++
    return query(stmt)
  }
  return { d, s, g, reads: () => n }
}
let seed = (f: ReturnType<typeof fixture>) =>
  f.g.apply([
    { entity: { eid: 'owner' }, session: {}, doc: { title: 'whole' } },
    {
      entity: { eid: 'reply' },
      entry: { session: 'owner', seq: 1 },
      output: { source: 'owner' },
      content: { body: 'answer' },
    },
  ], { trusted: true })
let status = (rows: Bundle[]) => (rows[0].session as { status: string }).status
let f = fixture()
await seed(f)
let read = (comps?: string[]) => f.g.get(['owner'], comps)
for (let comps of [undefined, ['session']]) {
  await read(comps)
  await read(comps)
}
let before = f.reads(), whole = await read(), named = await read(['session'])
let reused = f.reads() - before
;(whole[0].session as { status: string }).status = 'mutated'
let isolated = status(await read())
let inside: string[] = [], queried: [number, string][] = []
let check = async (g: typeof f.g) =>
  [
    (await g.read('.session.status=settled .fields=entity.eid')).length,
    status(await g.read('.session .fields=session.status')),
  ] as [number, string]
for (let n = 0; n < 3; n++) await check(f.g)
await f.s.tx(async () => {
  inside.push(status(await read()))
  queried.push(await check(f.g))
  await f.g.apply([{
    entity: { eid: 'input' },
    entry: { session: 'owner', seq: 2 },
    content: { body: 'next' },
  }], { trusted: true })
  inside.push(status(await read()))
  queried.push(await check(f.g))
  inside.push(status(await read()))
})
let rollback: string[] = []
try {
  await f.s.tx(async () => {
    await f.g.apply([{ entity: { eid: 'input' }, stop: {} }], { trusted: true })
    rollback.push(status(await read()))
    throw new Error('undo')
  })
} catch { /* The former transcript must return after rollback. */ }
rollback.push(status(await read()))
f.d.close()

test('whole and named derived gets reuse an unchanged SQL state', () => {
  equal(reused, 0)
  equal(named[0].session, { status: 'settled' })
  equal(whole[0].doc, { title: 'whole' })
  equal(isolated, 'settled')
})
test('an auxiliary entry write ends reuse inside the same transaction', () => {
  equal(inside, ['settled', 'running', 'running'])
  equal(queried, [[1, 'settled'], [0, 'running']])
})
test('rollback ends reuse of a derived value read inside the undone state', () => {
  equal(rollback, ['stopped', 'running'])
})

let dir = Deno.makeTempDirSync({ prefix: 'get-epoch-' })
let peer = fixture(dir + '/graph.db'), second = fixture(dir + '/graph.db')
let external: string[],
  schemaReads: number,
  peerQueries: [number, string][] = []
try {
  await seed(peer)
  for (let n = 0; n < 3; n++) await peer.g.get(['owner'])
  for (let n = 0; n < 3; n++) await check(peer.g)
  await second.g.apply([{ entity: { eid: 'reply' }, stop: {} }], {
    trusted: true,
  })
  external = [status(await peer.g.get(['owner']))]
  peerQueries.push(await check(peer.g))
  await second.g.apply([{ entity: { eid: 'reply' }, stop: null }], {
    trusted: true,
  })
  external.push(status(await peer.g.get(['owner'])))
  peerQueries.push(await check(peer.g))
  await peer.g.get(['owner'])
  second.d.query({ t: 'create table', name: 'beside', cols: [{ name: 'v' }] })
  let before = peer.reads()
  external.push(status(await peer.g.get(['owner'])))
  schemaReads = peer.reads() - before
} finally {
  second.d.close()
  peer.d.close()
  Deno.removeSync(dir, { recursive: true })
}
test('peer writes and schema changes end derived get reuse', () => {
  equal(external, ['stopped', 'settled', 'settled'])
  equal(peerQueries, [[0, 'stopped'], [1, 'settled']])
  ok(schemaReads > 0)
})

// No stability promise means every get may return a different value, even
// inside a transaction. The existing memo must not freeze that provider.
let dynamic = fixture(':memory:', {
  'session.status': { tag: 'number', expr: () => fn('random') },
})
await seed(dynamic)
let values: unknown[] = []
await dynamic.s.tx(async () => {
  for (let n = 0; n < 5; n++) {
    values.push((await dynamic.g.get(['owner']))[0].session)
  }
})
dynamic.d.close()
test('dynamic providers keep changing within one transaction', () => {
  equal(new Set(values.map((v) => JSON.stringify(v))).size, 5)
})

// A text override can interpret a historical imported notice differently
// without changing stored graph rows. sessionDerived must carry that doubt.
let text = {
  'content.body': {
    tag: 'text' as const,
    expr: () => lit('unused'),
    text: () => lit('notice'),
  },
}
let d = open(':memory:')
let store = storage(d, vocab, { derived: sessionDerived(vocab, text) })
store.install()
let g = graph({ storage: store, vocab, plugins: [archetypes()] })
await g.apply([
  { entity: { eid: 'owner' }, session: {} },
  {
    entity: { eid: 'notice' },
    entry: { session: 'owner', seq: 1 },
    notice: {},
    imported: { source: 'test', line: 1 },
    content: { body: 'stored' },
  },
], { trusted: true })
for (let n = 0; n < 3; n++) await g.get(['owner'])
let query = d.query, textReads = 0
d.query = (stmt) => {
  if (stmt.t == 'select' || stmt.t == 'raw') textReads++
  return query(stmt)
}
let textState = status(await g.get(['owner']))
d.close()
test('unproven content text overrides are read again without a graph write', () => {
  equal(textState, 'empty')
  ok(textReads > 0)
})

let scoped = fixture()
await seed(scoped)
for (let n = 0; n < 3; n++) await scoped.g.get(['owner'])
let scopes = [status(await scoped.g.get(['owner']))]
scopes.push(status(
  await scoped.g.get(['owner'], undefined, {
    visibility: { components: { entry: '!entry' } },
  }),
))
scopes.push(status(await scoped.g.get(['owner'])))
scoped.d.close()
test('a warmed authoritative answer cannot replace a scoped derived view', () => {
  equal(scopes, ['settled', 'empty', 'settled'])
})

let large = fixture()
await seed(large)
await large.g.apply([{
  entity: { eid: 'owner' },
  doc: { title: 'x'.repeat(16384) },
}])
for (let n = 0; n < 3; n++) await large.g.get(['owner'])
let at = large.reads(), oversized = await large.g.get(['owner'])
let fallthrough = large.reads() - at
large.d.close()
test('a whole answer over the existing byte bound remains a whole fresh read', () => {
  equal((oversized[0].doc as { title: string }).title.length, 16384)
  equal(status(oversized), 'settled')
  ok(fallthrough > 0)
})

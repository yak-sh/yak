// A component's table is made by the first write that names it (./raise.ts).
import { equal, test, throws } from '@yaks/testing'
import { catalogue, col, eq, fn, lit, select, sub, table } from '@yaks/sql'
import type { Stmt } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { open } from './db.ts'
import { mem } from './testing.ts'
import { meta, TABLES } from './meta.ts'
import { reader } from './reader.ts'
import { storage } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    doc: {
      component: true,
      properties: {
        title: { type: 'string' },
        loud: { type: 'string', computed: true },
      },
    },
    tag: {
      component: true,
      properties: { name: { type: 'string', unique: true } },
    },
    mark: { component: true, properties: {} },
  },
})
// A computed property read from another component's rows.
let derived = {
  'doc.loud': {
    tag: 'text' as const,
    expr: (owner: ReturnType<typeof col>) =>
      sub(select({
        cols: [fn('upper', col('name', '__t'))],
        from: table('tag', '__t'),
        where: eq(col('entity', '__t'), owner),
      })),
  },
}
// What a host keeps beside the store over its tables: a log of tagged marks,
// whose trigger on `mark` reads `tag`, so it rests on both.
let LOG: Stmt = {
  t: 'create table',
  name: 'marked',
  ifNot: true,
  cols: [{ name: 'entity', type: 'integer' }],
}
let over: Stmt[] = [LOG, {
  t: 'create trigger',
  name: 'marked_insert',
  ifNot: true,
  timing: 'after',
  event: 'insert',
  on: 'mark',
  when: sub(select({
    cols: [lit(1)],
    from: table('tag'),
    where: eq(col('entity', 'tag'), col('entity', 'new')),
  })),
  body: [{
    t: 'insert',
    into: 'marked',
    cols: ['entity'],
    rows: [[col('entity', 'new')]],
  }],
}]

let made = (d: ReturnType<typeof mem>) => {
  let s = storage(d, vocab, { derived, over: () => over })
  s.install()
  d.query(LOG)
  return s
}
let names = (d: ReturnType<typeof mem>, type: string) =>
  catalogue(d).filter((o) => o.type == type).map((o) => o.name)
let tables = (d: ReturnType<typeof mem>) =>
  names(d, 'table').filter((n) => vocab.comp(n))

test('an empty store holds no table for a word nobody wrote, and reads it as worn by nobody', () => {
  let d = mem(), s = made(d)
  equal(tables(d), [])
  equal(s.read('.doc'), [])
  equal(s.rows('.tag .count'), [{ value: '', n: 0 }])
  equal(s.read('.doc.loud=X'), [])
  equal(s.get(['a']), [])
})

test('a first write makes its component, with its indexes, and reads it back', async () => {
  let d = mem(), s = made(d)
  let g = graph({ storage: s, vocab })
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'Hi' } }])
  equal(tables(d), ['doc'])
  equal((await g.read('.doc'))[0].doc, { title: 'Hi' })
  // A property read from a component still unwritten reads as never given.
  equal(s.rows('.doc .fields=doc.loud'), [{ eid: 'a', 'doc.loud': null }])
  await g.apply([{ entity: { eid: 'a' }, tag: { name: 'red' } }])
  equal(tables(d), ['doc', 'tag'])
  equal(names(d, 'index').includes('tag_name'), true)
  equal((await g.read('.doc.loud=RED')).map((b) => b.entity.eid), ['a'])
  await throws(() => g.apply([{ entity: { eid: 'b' }, tag: { name: 'red' } }]))
  equal(meta(d).get(TABLES), 'doc tag tombstone')
})

test('what a host keeps over two tables is made once both stand', async () => {
  let d = mem(), s = made(d)
  let g = graph({ storage: s, vocab })
  await g.apply([{ entity: { eid: 'a' }, mark: {} }])
  equal(names(d, 'trigger').includes('marked_insert'), false)
  await g.apply([{ entity: { eid: 'b' }, tag: { name: 'blue' }, mark: {} }])
  equal(names(d, 'trigger').includes('marked_insert'), true)
  await g.apply([{ entity: { eid: 'c' }, tag: { name: 'green' } }])
  await g.apply([{ entity: { eid: 'c' }, mark: {} }])
  // b and c, each tagged when it was marked; a was marked before.
  equal(
    d.query(select({ cols: [col('entity')], from: table('marked') })).length,
    2,
  )
})

test('taking away a word nobody wrote makes nothing, and a removal reads no missing table', async () => {
  let d = mem(), s = made(d)
  let g = graph({ storage: s, vocab })
  await g.apply([{ entity: { eid: 'a' }, mark: {} }])
  await g.apply([{ entity: { eid: 'a' }, doc: null, tag: null }])
  equal(tables(d), ['mark'])
  await g.apply([{ entity: { eid: 'a' }, $delete: true }])
  equal(await g.read('.mark'), [])
})

test('a write that rolls back takes its tables with it, and the next one makes them again', async () => {
  let d = mem(), s = made(d)
  await throws(() =>
    s.tx((tx) => {
      tx.patch([{ entity: { eid: 'a' }, doc: { title: 'Gone' } }])
      throw new Error('abort')
    }), 'abort')
  equal(tables(d), [])
  equal(s.read('.doc'), [])
  s.tx((tx) => tx.patch([{ entity: { eid: 'a' }, doc: { title: 'Kept' } }]))
  equal(s.read('.doc')[0].doc, { title: 'Kept' })
})

test('a store holding every table, receipt or none, reads and writes as before', () => {
  let d = mem(), s = made(d)
  equal(s.raise().sort(), ['doc', 'mark', 'tag'])
  s.tx((tx) => tx.patch([{ entity: { eid: 'a' }, tag: { name: 'x' } }]))
  meta(d).del(TABLES)
  let again = storage(d, vocab, { derived, over: () => over })
  equal(again.install(), [])
  equal(again.read('.doc.loud=X').length, 0)
  equal(again.read('.tag')[0].tag, { name: 'x' })
  equal(again.raise(), [])
})

test('a reader of a file sees the tables another connection raised', () => {
  let path = Deno.makeTempFileSync({ suffix: '.db' })
  let w = open(path), r = open(path)
  try {
    let s = storage(w, vocab, { derived })
    s.install()
    let read = reader(r, vocab, { derived })
    equal(read.read('.doc'), [])
    s.tx((tx) => tx.patch([{ entity: { eid: 'a' }, doc: { title: 'Hi' } }]))
    equal(read.read('.doc')[0].doc, { title: 'Hi' })
    equal(read.read('.tag'), [])
  } finally {
    w.close()
    r.close()
    Deno.removeSync(path)
  }
})

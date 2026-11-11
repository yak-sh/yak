// A `~=` test beside a shape that selects by archetype (a presence and an
// absence) reads only the rows of the owners its substring index finds: few
// are sought by key, never picked out of every owner of the shape in the
// archetype index, and many are tested in that walk before any row is sought.
import '../sqlite/sqlitepath.ts'
import { Database } from '@yaks/sqlite/testing'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { type Bundle, graph } from '@yaks/graph'
import { compile, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import { driver } from '../sqlite/native.ts'
import { storage } from '../sqlite/mod.ts'
import { catalog } from '../sqlite/catalog.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { adopt, FEW_TEXTS, grams, search } from './mod.ts'

let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
}).symbols.sqlite3_stmt_status
let vocab = loadVocab([archetypeDoc, {
  $defs: {
    entity: { component: true, type: 'object' },
    note: {
      component: true,
      type: 'object',
      properties: { text: { type: 'string', contains: true } },
    },
    entry: { component: true, type: 'object' },
    draft: { component: true, type: 'object' },
  },
}])
let fields = grams(vocab)
let entry = (eid: string, text: string, more = {}): Bundle => ({
  entity: { eid },
  note: { text },
  entry: {},
  ...more,
})

// Entries about a wyrmling, one of them a draft, among `n` entries about
// something else and the `more` entries given: the eids `q` answers and the
// VM steps that took.
let world = (q: string, n: number, more: Bundle[] = []) => {
  let db = new Database(':memory:'), d = driver(db)
  let store = storage(d, vocab)
  store.install()
  let g = graph({ storage: store, vocab, plugins: [archetypes()] })
  g.apply([
    entry('kept', 'a wyrmling hatched'),
    entry('drafted', 'a wyrmling, maybe', { draft: {} }),
    ...Array.from({ length: n }, (_, i) => entry(`x${i}`, `a dragon ${i}`)),
    ...more,
  ])
  adopt(d, fields)
  let s = render(compile(parse(q), vocab, {
    archetypes: catalog(d),
    extend: [search(fields, d)],
  }))
  let stmt = db.prepare(s.sql)
  let eids = stmt.all(...s.params).map((r) => String(r.eid)).sort()
  return { eids, steps: status(stmt.unsafeHandle, 4, 0) }
}

test('a rare needle beside a shape seeks its owners, not every owner of the shape', () => {
  let q = '.note.text~=wyrmling .entry !draft .limit=5'
  let [small, large] = [10, 160].map((n) => world(q, n))
  equal(small.eids, ['kept'])
  equal(large.eids, ['kept'])
  ok(
    large.steps < small.steps + 100,
    `${small.steps} then ${large.steps} VM steps for sixteen times the entries`,
  )
})

test('a common needle beside a shape seeks only the rows of its owners', () => {
  // Each decoy holds every trigram of "on the hoard" but not the phrase, so
  // the owners are too many to drive the read and it walks the shape.
  let decoys = Array.from(
    { length: FEW_TEXTS + 1 },
    (_, i) => entry(`d${i}`, `${i}: on the end; he hoard`),
  )
  let q = '.note.text~="on the hoard" .entry !draft .limit=5'
  let hoard = entry('hoard', 'a wyrm sat on the hoard')
  let [small, large] = [10, 1_010].map((n) => world(q, n, [hoard, ...decoys]))
  equal(small.eids, ['hoard'])
  equal(large.eids, ['hoard'])
  let each = (large.steps - small.steps) / 1_000
  ok(each < 16, `${each} VM steps for each entry not among the owners`)
})

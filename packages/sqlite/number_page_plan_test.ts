// A page of recent documents must not sort their entire numbered history.
import { equal, ok, test } from '@yaks/testing'
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { loadVocab } from '@yaks/vocab'
import { compile, insert, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import { edgeDoc, traverse } from '@yaks/edge'
import { storage } from './mod.ts'
import { driver } from './native.ts'
import { sqlitePath } from './sqlitepath.ts'

let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
let vocab = loadVocab([edgeDoc, {
  $defs: {
    entity: {
      component: true,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: { component: true, properties: { title: { type: 'string' } } },
    hidden: { component: true },
    tombstone: { component: true },
  },
}])
let fixture = (n: number, recent: boolean) => {
  let db = new Database(':memory:'), d = driver(db)
  storage(d, vocab).install()
  // The highest numbers were imported first: numbering is not insertion order.
  d.query(insert(
    'entity',
    ...Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      eid: `recent-${i}`,
      num: 100_000 - i,
    })),
  ))
  for (let i = 0; i < n; i += 500) {
    let rows = Array.from({ length: Math.min(500, n - i) }, (_, j) => ({
      id: i + j + 101,
      eid: `old-${i + j}`,
      num: i + j,
    }))
    d.query(insert('entity', ...rows))
    d.query(insert('doc', ...rows.map((r) => ({ entity: r.id, title: r.eid }))))
  }
  if (recent) {
    d.query(insert(
      'doc',
      ...Array.from({ length: 100 }, (_, i) => ({
        entity: i + 1,
        title: `recent-${i}`,
      })),
    ))
  }
  d.query(insert('hidden', { entity: 1 }))
  d.query(insert('tombstone', { entity: 2 }))
  return { db, d, n, recent }
}
let dense = [fixture(100, true), fixture(10_000, true)]
let sparse = fixture(1000, false)
let page = (f: ReturnType<typeof fixture>, hidden = false, peers = false) => {
  let q = render(
    compile(
      parse(
        '.doc .order=-entity.num .limit=13' +
          (peers ? '&.edges.peers=doc.title&.edges.limit=52' : ''),
      ),
      vocab,
      {
        extend: [traverse(vocab)],
        visibility: hidden ? { entity: '!hidden' } : undefined,
      },
    ),
  )
  let stmt = f.db.prepare(q.sql)
  try {
    let rows = stmt.all(...q.params) as { eid: string }[]
    return {
      ids: rows.map((r) => r.eid),
      steps: status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0),
    }
  } finally {
    stmt.finalize()
  }
}

let observedDense = dense.map((f) => ({ n: f.n, got: page(f) }))
let observedHidden = page(dense[1], true)
let observedSparse = page(sparse)
let observedPeers = page(dense[1], false, true)

test('a numbered recent component page costs its prefix, not its history', () => {
  for (let { n, got } of observedDense) {
    equal(
      got.ids,
      [0, ...Array.from({ length: 12 }, (_, i) => i + 2)]
        .map((i) => `recent-${i}`),
    )
    ok(got.steps < 6000, `${n} historical docs: ${got.steps} VM steps`)
  }
})

test('a numbered prefix preserves visibility and tombstones', () => {
  let got = observedHidden
  equal(got.ids, Array.from({ length: 13 }, (_, i) => `recent-${i + 2}`))
  ok(got.steps < 10_000, `${got.steps} VM steps`)
})

test('a numbered page falls back when its recent prefix has too few matches', () => {
  equal(
    observedSparse.ids,
    Array.from({ length: 13 }, (_, i) => `old-${999 - i}`),
  )
})

test('a numbered page with peer edges keeps its bounded selection', () => {
  equal(observedPeers.ids, observedDense[1].got.ids)
  ok(observedPeers.steps < 6000, `${observedPeers.steps} VM steps`)
})

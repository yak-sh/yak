import { sqlitePath } from './sqlitepath.ts'
import { equal, ok, test } from '@yaks/testing'
import { Database } from '@db/sqlite'
import { graph } from '@yaks/graph'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { loadVocab } from '@yaks/vocab'
import { driver } from './native.ts'
import { storage } from './mod.ts'
import { catalog } from './catalog.ts'
import { compile, render } from '@yaks/sql'
import { parse } from '@yaks/query'

let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})

test('a session request lookup reads its entries instead of unrelated requests', () => {
  let db = new Database(':memory:'), d = driver(db)
  try {
    let vocab = loadVocab([archetypeDoc, {
      $defs: {
        session: { component: true, type: 'object' },
        entry: {
          component: true,
          type: 'object',
          index: [['session', 'seq']],
          properties: {
            session: { type: 'string', ref: 'session' },
            seq: { type: 'number' },
          },
        },
        using: {
          component: true,
          type: 'object',
          properties: { provider: { type: 'string' } },
        },
      },
    }])
    let s = storage(d, vocab)
    s.install()
    let g = graph({ storage: s, vocab, plugins: [archetypes()] })
    g.apply([
      { entity: { eid: 'target' }, session: {} },
      { entity: { eid: 'other' }, session: {} },
      ...['old', 'new'].map((eid, i) => ({
        entity: { eid },
        entry: { session: 'target', seq: i + 1 },
        using: { provider: 'fake' },
      })),
    ])
    d.query({ t: 'pragma', name: 'optimize', value: 0x10002 })
    for (let start = 0; start < 5000; start += 500) {
      s.tx((tx) =>
        tx.patch(Array.from({ length: 500 }, (_, n) => ({
          entity: { eid: `request-${start + n}` },
          entry: { session: 'other', seq: start + n },
          using: { provider: 'fake' },
        })))
      )
    }
    for (
      let [query, expected] of [
        ['.entry.session=target .using .limit=1', ['new']],
        ['.using .entry.session=target .order=-entry.seq .limit=2', [
          'new',
          'old',
        ]],
        ['.entry.session=target .using .order=entry.seq', ['old', 'new']],
      ] as const
    ) {
      let q = render(compile(parse(query), vocab, { archetypes: catalog(d) }))
      let stmt = db.prepare(q.sql)
      try {
        equal(stmt.all(...q.params).map((r) => r.eid), [...expected])
        let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
        ok(steps < 500, `${steps} VM steps\n${q.sql}`)
      } finally {
        stmt.finalize()
      }
    }
  } finally {
    db.close()
  }
})
test('unbounded retained sound catalog reads grow with catalog, never transcript history', () => {
  let db = new Database(':memory:'), d = driver(db)
  try {
    let vocab = loadVocab([archetypeDoc, {
      $defs: {
        sfx: {
          component: true,
          type: 'object',
          properties: { name: { type: 'string' } },
        },
        doc: {
          component: true,
          type: 'object',
          properties: { title: { type: 'string' } },
        },
      },
    }])
    let s = storage(d, vocab)
    s.install()
    let g = graph({ storage: s, vocab, plugins: [archetypes()] })
    g.apply(
      Array.from(
        { length: 20 },
        (_, n) => ({ entity: { eid: `sound-${n}` }, sfx: { name: String(n) } }),
      ),
    )
    d.query({ t: 'pragma', name: 'optimize', value: 0x10002 })
    for (let start = 0; start < 20000; start += 500) {
      s.tx((tx) =>
        tx.patch(
          Array.from(
            { length: 500 },
            (_, n) => ({
              entity: { eid: `old-${start + n}` },
              doc: { title: 'retained' },
            }),
          ),
        )
      )
    }
    let q = render(compile(parse('.sfx'), vocab, { archetypes: catalog(d) }))
    let stmt = db.prepare(q.sql)
    try {
      equal(stmt.all(...q.params).length, 20)
      let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
      ok(steps < 1000, `${steps} VM steps\n${q.sql}`)
    } finally {
      stmt.finalize()
    }
  } finally {
    db.close()
  }
})

test('retained output pages seek sparse replies, while dense request lookups seek their session', () => {
  let db = new Database(':memory:'), d = driver(db)
  try {
    let vocab = loadVocab([archetypeDoc, {
      $defs: {
        session: { component: true, type: 'object' },
        entry: {
          component: true,
          type: 'object',
          index: [['session', 'seq']],
          properties: {
            session: { type: 'string', ref: 'session' },
            seq: { type: 'number' },
          },
        },
        output: {
          component: true,
          type: 'object',
          properties: { source: { type: 'string', ref: 'entry' } },
        },
        created: {
          component: true,
          type: 'object',
          properties: { at: { type: 'string' } },
        },
        notice: { component: true, type: 'object' },
      },
    }])
    let s = storage(d, vocab)
    s.install()
    let g = graph({ storage: s, vocab, plugins: [archetypes()] })
    g.apply([
      { entity: { eid: 'target' }, session: {} },
      { entity: { eid: 'other' }, session: {} },
      ...['old', 'new', 'elsewhere', 'hidden'].map((eid, i) => ({
        entity: { eid },
        entry: { session: i == 2 ? 'other' : 'target', seq: i + 1 },
        output: {},
        created: { at: String(i) },
        ...i == 3 ? { notice: {} } : {},
      })),
    ])
    d.query({ t: 'pragma', name: 'optimize', value: 0x10002 })
    for (let start = 0; start < 5000; start += 500) {
      s.tx((tx) =>
        tx.patch(Array.from({ length: 500 }, (_, n) => ({
          entity: { eid: `legacy-${start + n}` },
          entry: { session: 'target' },
          notice: {},
        })))
      )
    }
    for (
      let query of [
        '.entry.session=target .output !notice .order=-created.at .limit=2',
        '.output .entry.session=target !notice .order=-created.at .limit=2',
        '.entry.session=target,other .output !notice .order=-created.at .limit=2',
      ]
    ) {
      let q = render(compile(parse(query), vocab, { archetypes: catalog(d) }))
      let stmt = db.prepare(q.sql)
      try {
        equal(
          stmt.all(...q.params).map((r) => r.eid),
          query.includes('target,other')
            ? ['elsewhere', 'new']
            : ['new', 'old'],
        )
        let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
        ok(steps < 1000, `${steps} VM steps\n${q.sql}`)
      } finally {
        stmt.finalize()
      }
    }
  } finally {
    db.close()
  }
})

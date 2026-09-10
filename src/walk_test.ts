// The fleet adapter to the shared package walk against an indexed graph.
// Small cases stay fast; the merge-DAG regression and 10k row valve use slow().
import { assert, assertEquals } from '@std/assert'
import './store/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { type Reach, WALK_LIMIT } from './query.ts'
import { reachRows } from './sql.ts'
import { type Bundle, matcher } from '@yaks/match'
import { loadVocab } from '@yaks/vocab'
import { slow } from './testing.ts'

let fixture = (
  size: number,
  cycle = false,
  merges = false,
  path = ':memory:',
) => {
  let db = new Database(path)
  db.exec(`
    create table entity(id integer primary key, eid text unique, num integer);
    create table edge(entity integer primary key, "from" integer, "to" integer, ord integer);
    create index edge_from on edge("from");
    create index edge_to on edge("to");
    create table requires(entity integer primary key);
    create table comment(entity integer primary key, target integer);
    create index comment_target on comment(target);
  `)
  let put = db.prepare('insert into entity values (?, ?, ?)')
  let edge = db.prepare('insert into edge values (?, ?, ?, null)')
  let tag = db.prepare('insert into requires values (?)')
  let ref = db.prepare('insert into comment values (?, ?)')
  let n = 0
  let link = (from: number, to: number) => {
    edge.run(++n, from, to)
    tag.run(n)
  }
  db.exec('begin')
  let rand = 42
  for (let i = 1; i <= size; i++) {
    put.run(i, `n${i}`, i)
    if (i > 1) {
      link(i, i - 1)
      ref.run(i, i - 1)
    }
    // One additional parent per twenty commits; deterministic earlier parent.
    if (merges && i % 20 == 0) {
      rand = (Math.imul(rand, 1664525) + 1013904223) >>> 0
      link(i, 1 + rand % (i - 2))
    }
  }
  if (cycle) {
    link(1, size)
    ref.run(1, size)
  }
  db.exec('commit')
  return db
}

let compile = reachRows
let chain = fixture(24)
let ring = fixture(24, true)
for (let ref of [false, true]) {
  let r: Reach = {
    type: ref ? 'comment.target' : 'requires',
    dir: '->',
    ...(ref ? { via: { comp: 'comment', prop: 'target' } } : {}),
  }
  let rows = (db: Database, target: string, reach = r) => {
    let q = compile(reach, target)
    return db.prepare(q.sql).all<{ id: number }>(...q.params).map((r) => r.id)
      .sort((a, b) => a - b)
  }
  for (let dir of ['->', '<-'] as const) {
    let q = compile({ ...r, dir }, dir == '->' ? 'n1' : 'n24')
    let stmt = chain.prepare(q.sql)
    let expected = Array.from(
      { length: 23 },
      (_, i) => i + (dir == '->' ? 2 : 1),
    )
    Deno.test(`fleet ${r.type}: default ${dir} chain passes 16 hops`, () => {
      let ids = stmt.all<{ id: number }>(...q.params).map((r) => r.id)
      assertEquals(ids.sort((a, b) => a - b), expected)
    })
  }
  Deno.test(`fleet ${r.type}: missing seed reaches nothing`, () => {
    assertEquals(rows(chain, 'missing'), [])
  })
  Deno.test(`fleet ${r.type}: cycle terminates and excludes the seed`, () => {
    assertEquals(
      rows(ring, 'n1'),
      Array.from({ length: 23 }, (_, i) => i + 2),
    )
  })
  Deno.test(`fleet ${r.type}: only an explicit cap bounds hops`, () => {
    assertEquals(rows(chain, 'n1', { ...r, depth: 2 }), [2, 3])
    assertEquals(
      rows(chain, 'n1', { ...r, depth: 16 }),
      Array.from({ length: 16 }, (_, i) => i + 2),
    )
    // Retain explicit-cap semantics: a nonzero path can reach the seed.
    assertEquals(rows(ring, 'n1', { ...r, depth: 24 }).length, 24)
    assert(!compile(r, 'n1').sql.includes('depth'))
    assert(compile({ ...r, depth: 2 }, 'n1').sql.includes('depth'))
  })
}

slow(
  'walk merge DAG: 2,000 commits, 5% merges, shared compiler under 50ms',
  () => {
    let path = Deno.makeTempFileSync({ suffix: '.sqlite' })
    let db = fixture(2000, false, true, path)
    try {
      let q = compile({ type: 'requires', dir: '->' }, 'n1')
      let stmt = db.prepare(q.sql)
      let times: number[] = []
      for (let i = 0; i < 5; i++) {
        let start = performance.now()
        let rows = stmt.all(...q.params)
        times.push(performance.now() - start)
        assertEquals(rows.length, 1999)
      }
      let ms = times.sort((a, b) => a - b)[2]
      console.log(
        `fleet: 2,000-node 5%-merge DAG median ${ms.toFixed(2)}ms`,
      )
      assert(ms < 50, `fleet: ${ms}ms`)
    } finally {
      db.close()
      Deno.removeSync(path)
    }
  },
)

slow(
  'walk row valve stops at the nearest 10,000 nodes, not 10,000 hops',
  () => {
    let db = fixture(WALK_LIMIT * 2)
    try {
      {
        for (let dir of ['->', '<-'] as const) {
          let q = compile(
            { type: 'requires', dir },
            dir == '->' ? 'n1' : `n${WALK_LIMIT * 2}`,
          )
          let ids = db.prepare(q.sql).all<{ id: number }>(...q.params).map((
            r,
          ) => r.id)
          assertEquals(ids.length, WALK_LIMIT)
          assertEquals(Math.min(...ids), dir == '->' ? 2 : WALK_LIMIT)
          assertEquals(
            Math.max(...ids),
            dir == '->' ? WALK_LIMIT + 1 : WALK_LIMIT * 2 - 1,
          )
        }
        // Explicit hop caps do not inherit the default row valve.
        let q = compile(
          { type: 'requires', dir: '->', depth: WALK_LIMIT + 1 },
          'n1',
        )
        assertEquals(db.prepare(q.sql).all(...q.params).length, WALK_LIMIT + 1)
      }
      // A wide one-hop graph proves this is a ROW valve, not a hop cap.
      db.exec('update edge set "to" = 1')
      {
        let q = compile({ type: 'requires', dir: '->' }, 'n1')
        assertEquals(db.prepare(q.sql).all(...q.params).length, WALK_LIMIT)
        q = compile({ type: 'requires', dir: '->', depth: 1 }, 'n1')
        assertEquals(
          db.prepare(q.sql).all(...q.params).length,
          WALK_LIMIT * 2 - 1,
        )
      }
    } finally {
      db.close()
    }
  },
)

slow(
  'in-memory walk shares the depth-free row valve on a long cyclic chain',
  () => {
    let vocab = loadVocab({
      $defs: {
        entity: { type: 'object', wire: false, properties: {} },
        comment: {
          type: 'object',
          properties: {
            target: { type: 'string', ref: 'entity', death: 'detach' },
          },
        },
      },
    })
    let rows: Bundle[] = Array.from({ length: WALK_LIMIT + 2 }, (_, i) => ({
      entity: { eid: `n${i + 1}` },
      comment: { target: `n${i == 0 ? WALK_LIMIT + 2 : i}` },
    }))
    let selected = matcher('.comment.target->n1', vocab)(rows)
    assertEquals(selected.length, WALK_LIMIT)
    assertEquals(selected[0].entity.eid, 'n2')
    assertEquals(selected.at(-1)!.entity.eid, `n${WALK_LIMIT + 1}`)
    assertEquals(matcher('.comment.target[<=2]->n1', vocab)(rows).length, 2)
  },
)

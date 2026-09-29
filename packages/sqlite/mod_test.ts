// The store as a whole: bound to a driver and a vocabulary, it installs its
// schema and speaks bundles — a write in, a read out, over one round trip.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import {
  bind,
  col,
  type Driver,
  isNull,
  render,
  select,
  table,
} from '@yaks/sql'
import { parse } from '@yaks/query'
import { objects, storage, type Store } from './mod.ts'
import { open } from './db.ts'
import { mem, shop, spy } from './testing.ts'

test('indexed text predicates seek their component rows', () => {
  let vocab = loadVocab({
    $defs: {
      seen: {
        component: true,
        type: 'object',
        properties: {
          level: { type: 'string', index: true },
          at: { type: 'string', format: 'date-time' },
          value: { type: 'string', format: 'json' },
        },
      },
    },
  })
  let driver = mem()
  let s = storage(driver, vocab)
  s.install()
  s.tx((tx) =>
    tx.patch([
      {
        entity: { eid: 'here' },
        seen: {
          level: 'mossvale',
          at: '2026-09-28T12:00:00.000Z',
          value: '1',
        },
      },
      {
        entity: { eid: 'away' },
        seen: {
          level: 'elsewhere',
          at: '2026-09-28T12:00:00.000Z',
          value: '2',
        },
      },
      {
        entity: { eid: 'old' },
        seen: {
          level: 'mossvale',
          at: '2026-09-28T11:00:00.000Z',
          value: '3',
        },
      },
      { entity: { eid: 'bare' } },
    ])
  )
  let query = '.seen.level=mossvale&.seen.at>=5-minutes-ago'
  let opts = { now: Date.parse('2026-09-28T12:02:00.000Z') }
  assertEquals(s.rows(query, opts), [{ eid: 'here' }])
  assertEquals(s.rows('.seen.value=1'), [{ eid: 'here' }])
  let plan = driver.query({
    t: 'explain query plan',
    of: bind(parse(query), vocab, opts),
  }).map((r) => String(r.detail)).join('\n')
  assert(plan.includes('SEARCH seen USING INDEX seen_level'), plan)
  assert(!plan.includes('SCAN entity'), plan)
})

test('stored property presence reads its component without scanning entities', () => {
  let vocab = loadVocab({
    $defs: {
      wake: {
        component: true,
        type: 'object',
        properties: { while: { type: 'array', items: { type: 'string' } } },
      },
    },
  })
  let driver = mem()
  let s = storage(driver, vocab)
  s.install()
  s.tx((tx) => {
    tx.patch([
      { entity: { eid: 'bare' } },
      { entity: { eid: 'first' }, wake: { while: ['a'] } },
      { entity: { eid: 'cleared' }, wake: { while: ['b'] } },
      { entity: { eid: 'buried' }, wake: { while: ['c'] } },
      { entity: { eid: 'last' }, wake: { while: [] } },
    ])
    tx.patch([{ entity: { eid: 'cleared' }, wake: { while: null } }])
    tx.remove([{ eid: 'buried' }])
  })

  assertEquals(s.rows('.wake.while'), [{ eid: 'first' }, { eid: 'last' }])
  let plan = driver.query({
    t: 'explain query plan',
    of: bind(parse('.wake.while'), vocab),
  }).map((r) => String(r.detail)).join('\n')
  assert(plan.includes('SCAN wake'), plan)
  assert(!plan.includes('SCAN entity'), plan)
})

test('ddl() lists the statements install() runs', () => {
  let s = storage(mem(), shop)
  let ddl = s.ddl()
  assert(ddl.length > 0)
  assert(
    ddl.some((s) =>
      render(s).sql.includes('create table if not exists "entity"')
    ),
  )
})

test('ddl() grows a populated table before indexing its new column', () => {
  let book = (indexed: boolean) =>
    loadVocab({
      $defs: {
        book: {
          component: true,
          type: 'object',
          ...(indexed ? { index: [['tag']] } : {}),
          properties: {
            title: { type: 'string' },
            ...(indexed ? { tag: { type: 'string' } } : {}),
          },
        },
      },
    })
  let d = mem()
  let old = storage(d, book(false))
  old.install()
  old.tx((tx) =>
    tx.patch([
      { entity: { eid: 'a' }, book: { title: 'A' } },
      { entity: { eid: 'b' }, book: { title: 'B' } },
    ])
  )

  let next = storage(d, book(true))
  for (let stmt of next.ddl()) d.query(stmt)
  let probe = select({
    cols: [col('entity')],
    from: table('book'),
    where: isNull(col('tag')),
  })
  let plan = d.query({ t: 'explain query plan', of: probe })
    .map((r) => String(r.detail)).join('\n')
  assert(plan.includes('book_tag'), plan)
  assertEquals(d.query(probe).length, next.read('.book').length)
  assertEquals(d.query({ t: 'pragma', name: 'integrity_check' }), [{
    integrity_check: 'ok',
  }])
})

test('install() is idempotent', () => {
  let s = storage(mem(), shop)
  s.install()
  s.install() // create-if-not-exists — a second run is a no-op, not an error
  s.tx((tx) => tx.patch([{ entity: { eid: 'x' }, doc: { title: 'Hi' } }]))
  assertEquals((s.read('.title~=hi') as Bundle[])[0].entity.eid, 'x')
})

test('an OR filtered by one or several entity ids keeps their matches', () => {
  let s = storage(mem(), shop)
  s.install()
  s.tx((tx) =>
    tx.patch([
      { entity: { eid: 'a' }, doc: { title: 'a' } },
      { entity: { eid: 'b' }, product: { price: 1 } },
      { entity: { eid: 'c' }, doc: { title: 'a' } },
      { entity: { eid: 'd' }, product: { price: 2 } },
    ])
  )
  let query = '(.doc.title=a|.product.price=1)&.eid='
  let ids = (q: string) =>
    (s.read(q) as Bundle[]).map((b) => b.entity.eid).sort()
  assertEquals(ids(query + 'b'), ['b'])
  assertEquals(ids(query + 'a,b,d'), ['a', 'b'])
})

test('a second store over an installed file leaves its schema alone', () => {
  let d = mem()
  storage(d, shop).install()
  let version = () => d.query({ t: 'pragma', name: 'schema_version' })
  let before = version()
  storage(d, shop).install()
  assertEquals(version(), before)
})

// One graph file, opened `times` times: each open installs the shop, then
// `beside` does what else a host does to the file → whether each install
// changed the schema.
let reopened = (times: number, beside: (d: Driver) => void) => {
  let dir = Deno.makeTempDirSync()
  try {
    return Array.from({ length: times }, () => {
      let d = open(`${dir}/graph.db`)
      try {
        let version = () =>
          d.query({ t: 'pragma', name: 'schema_version' })[0].schema_version
        let was = version()
        storage(d, shop).install()
        let moved = version() != was
        beside(d)
        return moved
      } finally {
        d.close()
      }
    })
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
}

test('an open of a file its schema is current in installs nothing', () => {
  // What a host's plugins keep beside the store's tables once it has
  // installed: a table of their own keyed by entity (@yaks/embedding's
  // vectors), and a trigger on doc that fills it (@yaks/fts).
  let plugins = (d: Driver) => {
    d.query({
      t: 'create table',
      name: 'vector',
      ifNot: true,
      cols: [{ name: 'entity', type: 'integer', pk: true }, {
        name: 'title',
        type: 'text',
      }],
    })
    d.query({
      t: 'create trigger',
      name: 'vector_doc_insert',
      ifNot: true,
      timing: 'after',
      event: 'insert',
      on: 'doc',
      body: [{
        t: 'insert',
        into: 'vector',
        cols: ['entity', 'title'],
        rows: [[col('entity', 'new'), col('title', 'new')]],
      }],
    })
  }
  assertEquals(reopened(3, plugins), [true, false, false])
})

test('an open puts back what another hand dropped from the schema', () => {
  let found: number[] = []
  let dropped = (d: Driver) => {
    found.push(objects(d, { name: 'shelf_aisle_height' }).length)
    d.query({ t: 'drop', kind: 'index', name: 'shelf_aisle_height' })
  }
  assertEquals(reopened(2, dropped), [true, true])
  assertEquals(found, [1, 1])
})

test('a driver that owns transactions is asked for them', () => {
  let base = mem()
  let seen: string[] = []
  let depth = 0
  let s = storage({
    ...spy(base, (sql) => void seen.push(sql)),
    // Stands in for an engine whose transactions are not SQL (a Durable
    // Object's `transactionSync`): the store must call this and emit no
    // savepoint of its own.
    tx: (body) => {
      depth++
      try {
        return body()
      } finally {
        depth--
      }
    },
  }, shop)
  s.install()
  let inside = s.tx((tx) => {
    tx.patch([{ entity: { eid: 'p1' }, doc: { title: 'Kettle' } }])
    return depth
  })
  assertEquals(inside, 1)
  assert(!seen.some((sql) => /savepoint|rollback|release/.test(sql)))
  assertEquals((s.read('.title~=kettle') as Bundle[])[0].entity.eid, 'p1')
})

test('a bundle written and read back is the same entity', () => {
  let s = storage(mem(), shop)
  s.install()
  s.tx((tx) =>
    tx.patch([{
      entity: { eid: 'p1' },
      doc: { title: 'Kettle' },
      product: { price: 40, status: 'live' },
    }])
  )
  let [p] = s.read('.kind=product') as Bundle[]
  assertEquals(p.entity.eid, 'p1')
  assertEquals((p.doc as Record<string, unknown>).title, 'Kettle')
  assertEquals((p.product as Record<string, unknown>).price, 40)
  assertEquals((p.product as Record<string, unknown>).status, 'live')
})

test('a driver over a FILE takes the write lock up front', () => {
  // The arrangement every `yak` line depends on: a graph is a file, and as
  // many processes as there are lines typed have it open. A deferred
  // transaction that read before it wrote cannot upgrade once another
  // connection has committed — SQLITE_BUSY, instantly, whatever the busy
  // timeout says — so the outermost unit says `begin immediate` and the
  // timeout has something to wait on. Everything inside it is a savepoint, as
  // ever: one connection has one transaction whatever the nesting says.
  let said: string[] = []
  let watched = (over: Driver): Driver =>
    spy(over, (sql) => void said.push(sql))
  let write = (s: Store) =>
    s.tx((tx) => {
      tx.read('.doc')
      tx.patch([{ entity: { eid: 'p1' }, doc: { title: 'Kettle' } }])
    })

  let dir = Deno.makeTempDirSync({ prefix: 'yaks-file-' })
  let db = open(`${dir}/graph.sqlite`)
  try {
    let file = storage(watched(db), shop)
    file.install()
    said.length = 0
    write(file)
    assertEquals(said.filter((sql) => /^(begin|commit|savepoint)/.test(sql)), [
      'begin immediate',
      'commit',
    ])
    // And a unit inside that one is a savepoint: the lock is already held.
    said.length = 0
    file.tx(() => file.tx(() => 0))
    assertEquals(
      said.filter((sql) => /^(begin|savepoint)/.test(sql)).map((sql) =>
        sql.split('_')[0]
      ),
      ['begin immediate', 'savepoint "yaks'],
    )
  } finally {
    db.close()
    Deno.removeSync(dir, { recursive: true })
  }

  // An in-memory database is this process's alone, so nothing else can be
  // writing it and there is no lock to take.
  said.length = 0
  let alone = storage(watched(mem()), shop)
  alone.install()
  said.length = 0
  write(alone)
  assertEquals(said.filter((sql) => /^(begin|commit)/.test(sql)), [])
  assert(said.some((sql) => sql.startsWith('savepoint')), said.join(' · '))
})

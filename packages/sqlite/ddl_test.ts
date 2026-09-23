// The schema a vocabulary implies: one identity table, one graveyard, one table
// per component, and the doc view (search indexes belong to @yaks/fts).

import { assert, assertEquals, assertThrows } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { compile, STOCK } from '@yaks/sql'
import memberDoc from '../member/vocab.json' with { type: 'json' }
import { schema } from './ddl.ts'
import { Database } from './db.ts'
import { storage } from './mod.ts'
import type { Driver } from './driver.ts'
import { mem, shop } from './harness.ts'

let all = schema(shop).join('\n')

// The live shape of a table, in declaration order.
let cols = (d: Driver, table: string) =>
  d.query(`pragma table_info("${table}")`, []).map((r) => String(r.name))

Deno.test('the shop vocabulary loads with its kinds and death words', () => {
  assertEquals(shop.all.includes('product'), true)
  assertEquals(shop.deaths('cascade'), [['review', 'product']])
  assertEquals(shop.deaths('detach'), [['product', 'maker']])
  assertEquals(shop.deaths('release'), [['bookmark', 'of']])
})

Deno.test('the spine and the graveyard are always present', () => {
  assert(/create table if not exists entity \(/.test(all), all)
  assert(all.includes('create table if not exists tombstone'), all)
})

Deno.test('every component gets a table keyed by an entity owner', () => {
  for (let comp of ['doc', 'product', 'review', 'bookmark']) {
    assert(
      new RegExp(`create table if not exists "${comp}" \\(`).test(all),
      `${comp} table missing`,
    )
  }
  // The spine component is the identity table, not a component table.
  assert(!all.includes('create table if not exists "entity"'), all)
})

Deno.test('a reference column stores an integer with a foreign key', () => {
  // product.maker is a reference — an integer id pointing at the spine.
  assert(/"maker" integer references entity\(id\)/.test(all), all)
})

Deno.test('a boolean column takes integer affinity, a text column text', () => {
  assert(/"available" integer/.test(all), all)
  assert(/"title" text/.test(all), all)
  assert(/"price" real/.test(all), all)
})

Deno.test('a doc vocabulary gets a read view but no implicit search index', () => {
  assert(all.includes('create view if not exists doc_value'), all)
  assert(!all.includes('fts5'), all)
  assert(!all.includes('create trigger if not exists doc'), all)
})

Deno.test('a resolved doc column is read as text by the view', () => {
  let resolved = schema(shop, {
    'doc.body': (stored) =>
      `(select "words" from "stash" where "k" = ${stored})`,
  }).join('\n')
  assert(resolved.includes(`"k" = "body") as "body"`), resolved)
  // The view still publishes every stored column for whole-document reads.
  for (let col of ['"entity"', '"title" as "title"', 'as "body"']) {
    assert(resolved.includes(col), col)
  }
})

Deno.test('the statements list in dependency order — spine first', () => {
  let stmts = schema(shop)
  assertEquals(stmts[0].includes('create table if not exists entity ('), true)
})

Deno.test('a column marked unique gets a unique index named after it', () => {
  assert(
    all.includes(
      'create unique index if not exists product_sku on "product" ("sku")',
    ),
    all,
  )
})

Deno.test('a component declares its composite unique and its index', () => {
  assert(
    all.includes(
      'create unique index if not exists shelf_aisle_slot ' +
        'on "shelf" ("aisle", "slot")',
    ),
    all,
  )
  assert(
    all.includes(
      'create index if not exists shelf_aisle_height ' +
        'on "shelf" ("aisle", "height")',
    ),
    all,
  )
})

Deno.test('an index comes after the table it covers', () => {
  let stmts = schema(shop)
  let table = stmts.findIndex((s) => s.includes('exists "shelf"'))
  let index = stmts.findIndex((s) => s.includes('shelf_aisle_slot'))
  assert(table >= 0 && index > table, `${table} ${index}`)
})

// A vocabulary that grew: `create table if not exists` is silent about a table
// that is already there, so a column added to a word has to arrive by
// `alter table` or every read naming it fails at the engine.
Deno.test('a column a component grew is added to the live table', () => {
  let spine = {
    component: true,
    type: 'object',
    wire: false,
    properties: {},
  } as const
  let text = { type: 'string' } as const
  let d = mem()
  let was = loadVocab({
    $defs: {
      entity: spine,
      book: {
        component: true,
        type: 'object',
        properties: { title: text },
      },
    },
  })
  let now = loadVocab({
    $defs: {
      entity: spine,
      book: {
        component: true,
        type: 'object',
        properties: {
          title: text,
          isbn: text,
          of: { type: 'string', ref: 'entity', death: 'detach' },
        },
      },
    },
  })
  storage(d, was).install()
  assertEquals(cols(d, 'book'), ['entity', 'title'])
  // The grown vocabulary over the same database: the two new columns arrive,
  // the reference carrying its foreign key, and nothing already there moves.
  let grew = storage(d, now)
  grew.install()
  assertEquals(cols(d, 'book'), ['entity', 'title', 'isbn', 'of'])
  assertEquals(
    d.query(
      `select name from sqlite_master where type = 'index' and name = 'book_of'`,
      [],
    ),
    [{ name: 'book_of' }],
  )
  // And a wake under a vocabulary the tables already match adds nothing.
  assertEquals(grew.grown(), [])
})

Deno.test('reference indexes are installed on new and existing member stores', () => {
  let vocab = loadVocab(memberDoc)
  for (let existing of [false, true]) {
    let d = mem()
    let s = storage(d, vocab)
    s.install()
    if (existing) {
      // A database created before references were indexed by default.
      for (
        let name of [
          'member_space',
          'member_person',
          'grant_app',
          'grant_person',
        ]
      ) {
        d.exec(`drop index ${name}`)
      }
    }
    s.tx((tx) =>
      tx.patch([
        { entity: { eid: 'person' } },
        { entity: { eid: 'space' } },
        { entity: { eid: 'app' } },
        {
          entity: { eid: 'seat' },
          member: { person: 'person', space: 'space' },
        },
        {
          entity: { eid: 'permission' },
          grant: { person: 'person', app: 'app' },
        },
      ])
    )
    // Reopening installs missing indexes additively; repeated installs are safe.
    s = storage(d, vocab)
    s.install()
    s.install()
    for (
      let [comp, prop, value, expected] of [
        ['member', 'person', 'person', 'seat'],
        ['member', 'space', 'space', 'seat'],
        ['grant', 'person', 'person', 'permission'],
        ['grant', 'app', 'app', 'permission'],
      ]
    ) {
      let query = `.${comp}.${prop}=${value}`
      let { sql, params } = compile(parse(query), vocab)
      let plan = d.query(
        `explain query plan ${sql}`,
        params as (string | number)[],
      )
        .map((r) => String(r.detail)).join('\n')
      assert(/SEARCH/.test(plan) && plan.includes(`${comp}_${prop}`), plan)
      assertEquals(s.read(query).map((b) => b.entity.eid), [expected])
      assertEquals(
        s.read(`.${comp}.${prop}=missing`).map((b) => b.entity.eid),
        [],
      )
      assertEquals(
        s.read(`${query},missing`).map((b) => b.entity.eid),
        [expected],
      )
    }
  }
})

// What the vocabulary can say about a table beyond its columns' types, with
// native JSON Schema where it has a word: `required` is NOT NULL, `default` is
// the row's fallback (the clock spelled `{now: true}`), `enum` is a check,
// `integer` keeps its affinity, and a composite may be partial.
let strict = loadVocab({
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: {},
    },
    created: {
      component: true,
      type: 'object',
      required: ['at'],
      properties: {
        at: { type: 'string', format: 'date-time', default: { now: true } },
        by: { type: 'string', ref: 'entity', death: 'keep' },
      },
    },
    repo: {
      component: true,
      type: 'object',
      required: ['base', 'push'],
      properties: {
        base: { type: 'string', default: 'main' },
        push: { type: 'boolean', default: false },
        seq: { type: 'integer' },
        state: {
          type: 'string',
          enum: ['stopped', 'running'],
          aliases: { on: 'running' },
        },
      },
    },
    output: {
      component: true,
      type: 'object',
      unique: [{ cols: ['key'], present: ['key'] }],
      properties: { key: { type: 'string' }, source: { type: 'integer' } },
    },
  },
})

Deno.test('constraints emit as the vocabulary said them', () => {
  let ddl = schema(strict).join('\n')
  assert(
    ddl.includes(
      `"at" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    ),
    ddl,
  )
  assert(ddl.includes(`"base" text not null default 'main'`), ddl)
  assert(ddl.includes(`"push" integer not null default 0`), ddl)
  assert(ddl.includes(`"seq" integer,`), ddl)
  assert(
    ddl.includes(`"state" text check("state" in ('stopped', 'running', 'on'))`),
    ddl,
  )
  assert(
    ddl.includes(
      `create unique index if not exists output_key on "output" ("key") where "key" is not null`,
    ),
    ddl,
  )
})

Deno.test('the engine holds what the vocabulary said', () => {
  let d = mem()
  storage(d, strict).install()
  d.exec(`insert into entity (id, eid) values (1, 'a'), (2, 'b'), (3, 'c')`)
  // A default fills what the writer omitted; the clock stamps an instant.
  d.exec(`insert into created (entity) values (1)`)
  d.exec(`insert into repo (entity) values (1)`)
  let [row] = d.query(`select base, push from repo where entity = 1`, [])
  assertEquals(row, { base: 'main', push: 0 })
  let [at] = d.query(`select at from created where entity = 1`, [])
  assert(/^\d{4}-\d\d-\d\dT.*Z$/.test(String(at.at)), String(at.at))
  // NOT NULL and CHECK refuse at the engine.
  assertThrows(() =>
    d.exec(`insert into created (entity, at) values (2, null)`)
  )
  assertThrows(() =>
    d.exec(`insert into repo (entity, state) values (2, 'flying')`)
  )
  d.exec(`insert into repo (entity, state) values (2, 'on')`)
  // A partial unique lets keyless rows be many and keyed rows be one.
  d.exec(`insert into output (entity) values (1), (2)`)
  d.exec(`insert into output (entity, key) values (3, 'k')`)
  assertThrows(() => d.exec(`update output set key = 'k' where entity = 2`))
})

Deno.test('a grown column keeps a literal default, takes the clock only ahead', () => {
  let d = mem()
  let was = loadVocab({
    $defs: {
      entity: {
        component: true,
        type: 'object',
        wire: false,
        properties: {},
      },
      created: {
        component: true,
        type: 'object',
        properties: {},
      },
      repo: {
        component: true,
        type: 'object',
        properties: {},
      },
    },
  })
  storage(d, was).install()
  d.exec(`insert into entity (id, eid) values (1, 'a')`)
  d.exec(`insert into repo (entity) values (1)`)
  d.exec(`insert into created (entity) values (1)`)
  let grew = storage(d, strict)
  let stmts = grew.grown()
  // A NOT NULL with a literal default is added as such (the literal fills the
  // rows already there); the clock is not a constant SQLite can add, so that
  // column arrives nullable and unstamped for the rows already written.
  assert(
    stmts.includes(
      `alter table "repo" add column "base" text not null default 'main'`,
    ),
    stmts.join('\n'),
  )
  assert(
    stmts.includes(`alter table "created" add column "at" text`),
    stmts.join('\n'),
  )
  grew.install()
  assertEquals(d.query(`select base from repo`, []), [{ base: 'main' }])
  assertEquals(d.query(`select at from created`, []), [{ at: null }])
})

Deno.test('a death word that moved rebuilds its table without the key', () => {
  let d = mem()
  storage(d, shop).install()
  d.exec(`insert into entity (id, eid) values (1, 'm'), (2, 'p')`)
  d.exec(`insert into product (entity, maker) values (2, 1)`)
  // A column the vocabulary has since forgotten still holds its rows.
  d.exec(`alter table product add column colour text`)
  d.exec(`update product set colour = 'red'`)
  let kept = loadVocab({
    $defs: {
      ...(shop.docs[0].$defs as Record<string, never>),
      product: {
        component: true,
        ...(shop.docs[0].$defs!.product as Record<string, never>),
        properties: {
          ...(shop.docs[0].$defs!.product.properties as Record<string, never>),
          // the maker outlives the product's memory of it
          maker: { type: 'string', ref: 'entity', death: 'keep' },
        },
      },
    },
  })
  let keys = () =>
    d.query(`pragma foreign_key_list("product")`, []).map((r) => r.from).sort()
  assertEquals(keys(), ['entity', 'maker'])
  storage(d, kept).install()
  assertEquals(keys(), ['entity'])
  assertEquals(d.query(`select maker, colour from product`, []), [
    { maker: 1, colour: 'red' },
  ])
  // and the maker can go without taking the record of it
  d.exec(`delete from entity where id = 1`)
  assertEquals(d.query(`select maker from product`, []), [{ maker: 1 }])
})

Deno.test('a store over a file installs the sizes its planner reads it by', () => {
  let path = Deno.makeTempFileSync({ suffix: '.sqlite' })
  let db = new Database(path)
  let d: Driver = {
    query: (sql, params) => db.prepare(sql).all(...params),
    exec: (sql) => db.exec(sql),
    file: true,
    arms: STOCK,
  }
  try {
    storage(d, shop).install()
    d.exec(`insert into entity (id, eid) values (1, 'a'), (2, 'b'), (3, 'c')`)
    d.exec(`insert into product (entity, sku) values (1, 'x')`)
    // A second install is what a later boot runs: the sizes are recorded
    // there, so a query over `product` is planned as the one row it is rather
    // than as a walk of the spine.
    storage(d, shop).install()
    // The first word of a `stat` is the table's row count, whether the row is
    // an index's or the table's own.
    let rows = (t: string) =>
      String(
        d.query(`select stat from sqlite_stat1 where tbl = ?`, [t])[0]?.stat,
      )
        .split(' ')[0]
    assertEquals(rows('entity'), '3')
    assertEquals(rows('product'), '1')
  } finally {
    db.close()
    Deno.removeSync(path)
  }
})

Deno.test('a store that is not a file is left unmeasured', () => {
  let said: string[] = []
  let d = mem()
  storage({ ...d, exec: (sql) => (said.push(sql), d.exec(sql)) }, shop)
    .install()
  assertEquals(said.filter((s) => s.startsWith('pragma')), [])
})

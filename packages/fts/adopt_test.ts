// A database that already has search objects — cut by hand, before it used this
// package — is brought to the schema without losing the words it indexed, and
// a second pass changes nothing.

import { assert, assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import {
  as,
  by,
  col,
  type CreateTrigger,
  type CreateVirtual,
  type Driver,
  eq,
  exists,
  type Expr,
  fn,
  type Insert,
  insert,
  left,
  lit,
  op,
  type Query,
  select,
  type Stmt,
  sub,
  table,
  val,
  type Write,
} from '@yaks/sql'
import { objects as schemaOf } from '@yaks/sqlite'
import { adopt, fields, find, heal, schema } from './mod.ts'
import {
  entity,
  mem,
  owner,
  raised,
  shelf,
  shop,
  SPINE,
  STASH,
  stash,
  text,
  TOMBSTONE,
} from './testing.ts'

// A vocabulary shaped like a mailbox: a document whose body is filed under an
// address, a log entry whose body is inline, and a letter's envelope.
let post = loadVocab({
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string', search: true },
        body: { type: 'string', search: true },
      },
    },
    content: {
      component: true,
      type: 'object',
      properties: { body: { type: 'string', search: true } },
    },
    mail: {
      component: true,
      type: 'object',
      properties: {
        from: { type: 'string', stamped: true, search: true },
        to_addr: { type: 'string', stamped: true, search: true },
      },
    },
  },
})

let stashed = { 'doc.body': stash('doc', 'body') }

// The search objects an application once wrote by hand: one document index
// carrying the envelope as a third column read through a joined view, six
// triggers feeding it from two tables, a substring index beside it, and a log
// index whose delete triggers guard rows older than the index.
let addr = (m?: string) =>
  fn(
    'trim',
    op(
      '||',
      fn('coalesce', col('from', m), lit('')),
      lit(' '),
      fn('coalesce', col('to_addr', m), lit('')),
    ),
  )
let addrAt = (entity: Expr) =>
  fn(
    'coalesce',
    sub(select({
      cols: [addr()],
      from: table('mail'),
      where: eq(col('entity'), entity),
    })),
    lit(''),
  )
let words = (key: Expr) =>
  sub(select({
    cols: [col('words')],
    from: table('stash'),
    where: eq(col('key'), key),
  }))
let at = (row: 'new' | 'old') => (name: string) => col(name, row)
let NEW = at('new'), OLD = at('old')
let DOC = ['rowid', 'title', 'body', 'addr']
let DOC_DELETE = ['doc_fts', ...DOC]

// A trigger on a table, and what it writes.
let on = (
  name: string,
  event: 'insert' | 'update' | 'delete',
  table: string,
  body: Write[],
  when?: Expr,
): CreateTrigger => ({
  t: 'create trigger',
  name,
  timing: 'after',
  event,
  on: table,
  when,
  body,
})
let into = (name: string, cols: string[], row: Expr[]): Insert => ({
  t: 'insert',
  into: name,
  cols,
  rows: [row],
})
let from = (name: string, cols: string[], q: Query): Insert => ({
  t: 'insert',
  into: name,
  cols,
  q,
})
// The document index's row for an entity, read back out of its view.
let docRow = (lead: Expr[], entity: Expr) =>
  select({
    cols: lead,
    from: table('doc_value'),
    where: eq(col('rowid'), entity),
  })
let docOf = (
  row: typeof NEW,
) => [row('rowid'), row('title'), words(row('body')), addrAt(row('entity'))]
let has = (name: string, where: Expr) =>
  exists(select({ cols: [lit(1)], from: table(name), where }))
let fts5 = (
  name: string,
  cols: string[],
  content: string,
  rowid: string,
  ...more: [string, string][]
): CreateVirtual => ({
  t: 'create virtual table',
  name,
  using: 'fts5',
  args: [...cols, ['content', content], ['content_rowid', rowid], ...more],
})

let LEGACY: Stmt[] = [
  {
    t: 'create view',
    name: 'doc_value',
    q: select({
      cols: [
        as(col('entity', 'd'), 'rowid'),
        col('entity', 'd'),
        col('title', 'd'),
        as(words(col('body', 'd')), 'body'),
        as(addr('m'), 'addr'),
      ],
      from: table('doc', 'd'),
      joins: [
        left(table('mail', 'm'), eq(col('entity', 'm'), col('entity', 'd'))),
      ],
    }),
  },
  fts5('doc_fts', ['title', 'body', 'addr'], 'doc_value', 'rowid'),
  on('doc_fts_ai', 'insert', 'doc', [into('doc_fts', DOC, docOf(NEW))]),
  on('doc_fts_ad', 'delete', 'doc', [
    into('doc_fts', DOC_DELETE, [lit('delete'), ...docOf(OLD)]),
  ]),
  on('doc_fts_au', 'update', 'doc', [
    into('doc_fts', DOC_DELETE, [lit('delete'), ...docOf(OLD)]),
    into('doc_fts', DOC, docOf(NEW)),
  ]),
  on(
    'mail_fts_ai',
    'insert',
    'mail',
    [
      from(
        'doc_fts',
        DOC_DELETE,
        docRow(
          [lit('delete'), col('rowid'), col('title'), col('body'), lit('')],
          NEW('entity'),
        ),
      ),
      from('doc_fts', DOC, docRow(DOC.map((c) => col(c)), NEW('entity'))),
    ],
    has('doc', eq(col('entity'), NEW('entity'))),
  ),
  on(
    'mail_fts_au',
    'update',
    'mail',
    [
      from(
        'doc_fts',
        DOC_DELETE,
        docRow(
          [lit('delete'), col('rowid'), col('title'), col('body'), addr('old')],
          NEW('entity'),
        ),
      ),
      from('doc_fts', DOC, docRow(DOC.map((c) => col(c)), NEW('entity'))),
    ],
    has('doc', eq(col('entity'), NEW('entity'))),
  ),
  on(
    'mail_fts_ad',
    'delete',
    'mail',
    [
      from(
        'doc_fts',
        DOC_DELETE,
        docRow(
          [lit('delete'), col('rowid'), col('title'), col('body'), addr('old')],
          OLD('entity'),
        ),
      ),
      from(
        'doc_fts',
        DOC,
        docRow(
          [col('rowid'), col('title'), col('body'), lit('')],
          OLD('entity'),
        ),
      ),
    ],
    has('doc', eq(col('entity'), OLD('entity'))),
  ),
  fts5('doc_gram', ['title', 'body'], 'doc_value', 'rowid', [
    'tokenize',
    'trigram',
  ]),
  on('doc_gram_ai', 'insert', 'doc', [
    into('doc_gram', ['rowid', 'title', 'body'], [
      NEW('rowid'),
      NEW('title'),
      words(NEW('body')),
    ]),
  ]),
  fts5('content_fts', ['body'], 'content', 'entity'),
  on('content_fts_ai', 'insert', 'content', [
    into('content_fts', ['rowid', 'body'], [NEW('entity'), NEW('body')]),
  ]),
  on(
    'content_fts_ad',
    'delete',
    'content',
    [
      into('content_fts', ['content_fts', 'rowid', 'body'], [
        lit('delete'),
        OLD('entity'),
        OLD('body'),
      ]),
    ],
    has('content_fts_docsize', eq(col('id'), OLD('entity'))),
  ),
  on('content_fts_au', 'update', 'content', [
    from(
      'content_fts',
      ['content_fts', 'rowid', 'body'],
      select({
        cols: [lit('delete'), OLD('entity'), OLD('body')],
        where: has('content_fts_docsize', eq(col('id'), OLD('entity'))),
      }),
    ),
    into('content_fts', ['rowid', 'body'], [NEW('entity'), NEW('body')]),
  ]),
]

let TABLES: Stmt[] = [
  SPINE,
  TOMBSTONE,
  raised('doc', owner, text('title'), text('body')),
  raised('content', owner, text('body')),
  raised('mail', owner, text('from'), text('to_addr')),
  STASH,
]

// The mailbox as the hand-cut objects left it: a letter and a note, and two log
// entries of which the first predates the log's index.
let mailbox = (): Driver => {
  let db = mem()
  for (let s of TABLES) db.query(s)
  entity(db, 1, 'letter')
  entity(db, 2, 'note')
  entity(db, 3, 'entry-old')
  entity(db, 4, 'entry-new')
  db.query(insert('content', { entity: 3, body: 'glazed ceramic' }))
  for (let s of LEGACY) db.query(s)
  db.query(
    insert('stash', { key: 'w1', words: 'A burglar leaves home.' }, {
      key: 'w2',
      words: 'Riders defend a world.',
    }),
  )
  db.query(
    insert('doc', { entity: 1, title: 'The Hobbit', body: 'w1' }, {
      entity: 2,
      title: 'Dragonflight',
      body: 'w2',
    }),
  )
  db.query(
    insert('mail', { entity: 1, from: 'bilbo@shire', to_addr: 'gandalf@grey' }),
  )
  db.query(insert('content', { entity: 4, body: 'ceramic craft' }))
  return db
}

// Every object but SQLite's own and the indexes' shadows and writers — the
// names `like` matched with `_` standing for any one character.
let objects = (db: Driver) =>
  schemaOf(db).filter((o) => !/^sqlite.|.fts.|.gram./.test(String(o.name)))
// SQLite's own count of how many times this database's schema has changed. A
// drop-and-raise of an identical view leaves the schema reading the same,
// so only this tells a no-op pass from one that rewrote the schema — and a
// host that adopts at every boot pays a file write for each rewrite.
let cookie = (db: Driver) =>
  Number(db.query({ t: 'pragma', name: 'schema_version' })[0].schema_version)
let triggers = (db: Driver) =>
  schemaOf(db, { type: 'trigger' }).map((r) => String(r.name)).sort()
let found = (db: Driver, word: string) =>
  find(db, fields(post), word).map((h) => h.entity).sort()

Deno.test('adopt keeps an index whose columns match, re-cuts one that does not, and drops the extra writers', () => {
  let db = mailbox()
  let log = objects(db).find((o) => o.name == 'content_fts')!.sql
  let done = adopt(db, fields(post), stashed)
  // The document index declared an envelope column of its own; the package
  // indexes a letter's envelope in the letter's index. The log index said
  // exactly what the package says, so its words were never re-indexed.
  assertEquals(done.recut, ['doc_fts', 'mail_fts'])
  assertEquals(done.dropped.sort(), [
    'content_fts_ad',
    'content_fts_ai',
    'content_fts_au',
    'doc_fts_ad',
    'doc_fts_ai',
    'doc_fts_au',
    'mail_fts_ad',
    'mail_fts_ai',
    'mail_fts_au',
  ])
  // …but it was missing the entry written before it existed.
  assertEquals(done.healed, ['content_fts'])
  assertEquals(objects(db).find((o) => o.name == 'content_fts')!.sql, log)
  // Every writer left is one of the package's three per index; the substring
  // index beside them, which writes into no index here, was not touched.
  assertEquals(triggers(db), [
    'content_fts_delete',
    'content_fts_insert',
    'content_fts_update',
    'doc_fts_delete',
    'doc_fts_insert',
    'doc_fts_update',
    'doc_gram_ai',
    'mail_fts_delete',
    'mail_fts_insert',
    'mail_fts_update',
  ])
  assertEquals(found(db, 'burglar'), ['letter'])
  assertEquals(found(db, 'gandalf'), ['letter'])
  assertEquals(found(db, 'ceramic'), ['entry-new', 'entry-old'])
  // And the words follow the rows through the package's own triggers.
  db.query({
    t: 'update',
    table: 'mail',
    set: { to_addr: val('frodo@shire') },
    where: by({ entity: 1 }),
  })
  assertEquals(found(db, 'gandalf'), [])
  assertEquals(found(db, 'frodo'), ['letter'])
})

Deno.test('a second adopt changes nothing', () => {
  let db = mailbox()
  adopt(db, fields(post), stashed)
  let before = objects(db), cut = cookie(db)
  assertEquals(adopt(db, fields(post), stashed), {
    recut: [],
    dropped: [],
    healed: [],
  })
  assertEquals(objects(db), before)
  assertEquals(cookie(db), cut)
})

Deno.test('a fresh schema is already adopted', () => {
  let db = shelf()
  let before = objects(db), cut = cookie(db)
  assertEquals(adopt(db, fields(shop)), { recut: [], dropped: [], healed: [] })
  assertEquals(objects(db), before)
  assertEquals(cookie(db), cut)
})

Deno.test('membership counts what the index holds, not what its table does', () => {
  // An index cut after its table already had rows is born empty. Counting the
  // index itself reads the table it mirrors and calls them equal; the shadow
  // table knows better.
  let db = mem()
  for (let s of TABLES) db.query(s)
  entity(db, 1, 'note')
  db.query(insert('doc', { entity: 1, title: 'Dune', body: null }))
  for (let s of schema(fields(post))) db.query(s)
  assertEquals(found(db, 'dune'), [])
  assertEquals(heal(db, fields(post), { deep: false }), ['doc_fts'])
  assertEquals(found(db, 'dune'), ['note'])
  assert(heal(db, fields(post)).length == 0)
})

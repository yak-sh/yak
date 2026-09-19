// A database that already has search objects — cut by hand, before it used this
// package — is brought to the schema without losing the words it indexed, and
// a second pass changes nothing.

import { assert, assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import type { Driver } from './driver.ts'
import { adopt, fields, find, heal, schema, type Text } from './mod.ts'
import { mem, shelf, shop } from './harness.ts'

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

let stashed: Text = {
  'doc.body': (key) =>
    `(select __s."words" from "stash" __s where __s."key" = ${key})`,
}

// The search objects an application once wrote by hand: ONE document index
// carrying the envelope as a third column read through a joined view, six
// triggers feeding it from two tables, a substring index beside it, and a log
// index whose delete triggers guard rows older than the index.
let addr = (m: string) =>
  `trim(coalesce(${m}"from", '') || ' ' || coalesce(${m}to_addr, ''))`
let addrAt = (entity: string) =>
  `coalesce((select ${addr('')} from mail where entity = ${entity}), '')`
let words = (key: string) => `(select words from stash where key = ${key})`
let LEGACY = `
  create view doc_value as
    select d.entity as rowid, d.entity, d.title, ${words('d.body')} as body,
      ${addr('m.')} as addr
    from doc d left join mail m on m.entity = d.entity;
  create virtual table doc_fts using fts5(
    title, body, addr, content='doc_value', content_rowid='rowid'
  );
  create trigger doc_fts_ai after insert on doc begin
    insert into doc_fts (rowid, title, body, addr)
    values (new.rowid, new.title, ${words('new.body')}, ${
  addrAt('new.entity')
});
  end;
  create trigger doc_fts_ad after delete on doc begin
    insert into doc_fts (doc_fts, rowid, title, body, addr)
    values ('delete', old.rowid, old.title, ${words('old.body')}, ${
  addrAt('old.entity')
});
  end;
  create trigger doc_fts_au after update on doc begin
    insert into doc_fts (doc_fts, rowid, title, body, addr)
    values ('delete', old.rowid, old.title, ${words('old.body')}, ${
  addrAt('old.entity')
});
    insert into doc_fts (rowid, title, body, addr)
    values (new.rowid, new.title, ${words('new.body')}, ${
  addrAt('new.entity')
});
  end;
  create trigger mail_fts_ai after insert on mail
  when exists (select 1 from doc where entity = new.entity) begin
    insert into doc_fts (doc_fts, rowid, title, body, addr)
      select 'delete', rowid, title, body, '' from doc_value
       where rowid = new.entity;
    insert into doc_fts (rowid, title, body, addr)
      select rowid, title, body, addr from doc_value where rowid = new.entity;
  end;
  create trigger mail_fts_au after update on mail
  when exists (select 1 from doc where entity = new.entity) begin
    insert into doc_fts (doc_fts, rowid, title, body, addr)
      select 'delete', rowid, title, body, ${addr('old.')} from doc_value
       where rowid = new.entity;
    insert into doc_fts (rowid, title, body, addr)
      select rowid, title, body, addr from doc_value where rowid = new.entity;
  end;
  create trigger mail_fts_ad after delete on mail
  when exists (select 1 from doc where entity = old.entity) begin
    insert into doc_fts (doc_fts, rowid, title, body, addr)
      select 'delete', rowid, title, body, ${addr('old.')} from doc_value
       where rowid = old.entity;
    insert into doc_fts (rowid, title, body, addr)
      select rowid, title, body, '' from doc_value where rowid = old.entity;
  end;
  create virtual table doc_gram using fts5(
    title, body, content='doc_value', content_rowid='rowid', tokenize='trigram'
  );
  create trigger doc_gram_ai after insert on doc begin
    insert into doc_gram (rowid, title, body)
    values (new.rowid, new.title, ${words('new.body')});
  end;
  create virtual table content_fts using fts5(
    body, content='content', content_rowid='entity'
  );
  create trigger content_fts_ai after insert on content begin
    insert into content_fts (rowid, body) values (new.entity, new.body);
  end;
  create trigger content_fts_ad after delete on content
  when exists (select 1 from content_fts_docsize where id = old.entity) begin
    insert into content_fts (content_fts, rowid, body)
      values ('delete', old.entity, old.body);
  end;
  create trigger content_fts_au after update on content begin
    insert into content_fts (content_fts, rowid, body)
      select 'delete', old.entity, old.body
      where exists (select 1 from content_fts_docsize where id = old.entity);
    insert into content_fts (rowid, body) values (new.entity, new.body);
  end;`

let TABLES = `
  create table entity (id integer primary key, eid text not null unique, num integer);
  create table tombstone (entity integer primary key references entity(id), deleted_at text not null);
  create table doc (entity integer primary key references entity(id), title text, body text);
  create table content (entity integer primary key references entity(id), body text);
  create table mail (entity integer primary key references entity(id), "from" text, to_addr text);
  create table stash (key text primary key, words text);`

// The mailbox as the hand-cut objects left it: a letter and a note, and two log
// entries of which the first predates the log's index.
let mailbox = (): Driver => {
  let db = mem()
  db.exec(TABLES)
  let entity = (id: number, eid: string) =>
    db.exec(`insert into entity (id, eid, num) values (${id}, '${eid}', ${id})`)
  entity(1, 'letter')
  entity(2, 'note')
  entity(3, 'entry-old')
  entity(4, 'entry-new')
  db.exec(`insert into content (entity, body) values (3, 'glazed ceramic')`)
  db.exec(LEGACY)
  db.exec(`insert into stash (key, words) values
    ('w1', 'A burglar leaves home.'), ('w2', 'Riders defend a world.')`)
  db.exec(`insert into doc (entity, title, body) values
    (1, 'The Hobbit', 'w1'), (2, 'Dragonflight', 'w2')`)
  db.exec(
    `insert into mail (entity, "from", to_addr) values (1, 'bilbo@shire', 'gandalf@grey')`,
  )
  db.exec(`insert into content (entity, body) values (4, 'ceramic craft')`)
  return db
}

let objects = (db: Driver) =>
  db.query(
    `select type, name, sql from sqlite_master
     where name not like 'sqlite_%' and name not like '%_fts_%'
       and name not like '%_gram_%' order by name`,
    [],
  )
// SQLite's own count of how many times this database's schema has changed. A
// drop-and-raise of an identical view leaves sqlite_master reading the same,
// so only this tells a no-op pass from one that rewrote the schema — and a
// host that adopts at every boot pays a file write for each rewrite.
let cookie = (db: Driver) =>
  Number(db.query('pragma schema_version', [])[0].schema_version)
let triggers = (db: Driver) =>
  db.query(`select name from sqlite_master where type = 'trigger'`, [])
    .map((r) => String(r.name)).sort()
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
  db.exec(`update mail set to_addr = 'frodo@shire' where entity = 1`)
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
  db.exec(TABLES)
  db.exec(`insert into entity (id, eid, num) values (1, 'note', 1)`)
  db.exec(`insert into doc (entity, title, body) values (1, 'Dune', null)`)
  for (let s of schema(fields(post))) db.exec(s)
  assertEquals(found(db, 'dune'), [])
  assertEquals(heal(db, fields(post), { deep: false }), ['doc_fts'])
  assertEquals(found(db, 'dune'), ['note'])
  assert(heal(db, fields(post)).length == 0)
})

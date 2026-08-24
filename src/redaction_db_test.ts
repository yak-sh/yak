// Redaction's database contract: live and historical content disappear in one
// act, derived copies cannot answer with it, and the hash-only audit persists.
import { assert, assertEquals, assertThrows } from '@std/assert'

Deno.env.set('DB_PATH', ':memory:')

let { apply, inverseBatch, lastBatch, readComp, redact, search, sha } =
  await import('./db.ts')
let { bareDb } = await import('./testdb.ts')

bareDb()
let uid = () => crypto.randomUUID()
let batches = (db: ReturnType<typeof bareDb>) =>
  (db.prepare('select batch from journal order by rowid').all() as {
    batch: string
  }[]).map((row) => row.batch)

Deno.test('redact: live doc, journal, indexes, embedding, and audit move atomically', () => {
  let db = bareDb()
  let target = uid()
  let actor = uid()
  let secret = 'needle-credential-12696'
  apply(db, [
    { eid: actor, name: 'person', comp: {} },
    { eid: actor, name: 'doc', comp: { title: 'Operator' } },
  ])
  apply(db, [{
    eid: target,
    name: 'doc',
    comp: { title: 'Target', body: `before ${secret} after ${secret}` },
  }])
  db.prepare(
    `insert into embedding (eid, model, hash, vec) values (?, 'm', 'h', ?)`,
  ).run(target, new Uint8Array([1, 2, 3, 4]))

  let out = redact(db, target, secret, actor)

  assertEquals(
    readComp(db, target, 'doc')?.body,
    'before [redacted] after [redacted]',
  )
  assertEquals(search(db, secret), [])
  assertEquals(
    db.prepare(`select count(*) as n from doc_gram where body like ?`)
      .get(`%${secret}%`),
    { n: 0 },
  )
  assertEquals(
    db.prepare('select count(*) as n from embedding where eid = ?').get(target),
    { n: 0 },
  )
  assert(batches(db).every((batch) => !batch.includes(secret)))
  assertEquals(readComp(db, out.audit, 'redaction'), {
    eid: out.audit,
    target,
    column: 'body',
    hash: sha(secret),
  })
  assertEquals(readComp(db, out.audit, 'created')?.by, actor)
  assertEquals(out.journalRows, 1)
  assertEquals(out.replacements, 2)

  // The latest batch includes the audit birth. Undo cannot delete that
  // permanent fact, and therefore cannot resurrect pre-redaction content.
  let undo = inverseBatch(db, lastBatch(db, target))
  assertThrows(
    () => apply(db, undo),
    Error,
    'permanent redaction audit',
  )
  assert(batches(db).every((batch) => !batch.includes(secret)))
})

Deno.test('redact: historical-only literals work; ambiguity and failures change nothing', () => {
  let db = bareDb()
  let target = uid()
  let secret = 'historical-only-12696'
  apply(db, [{
    eid: target,
    name: 'doc',
    comp: { title: 'Target', body: `old ${secret}` },
  }])
  apply(db, [{ eid: target, name: 'doc', comp: { body: 'already clean' } }])

  let out = redact(db, target, secret)
  assertEquals(out.column, 'body')
  assertEquals(readComp(db, target, 'doc')?.body, 'already clean')
  assert(batches(db).every((batch) => !batch.includes(secret)))

  let both = uid()
  apply(db, [{
    eid: both,
    name: 'doc',
    comp: { title: 'same-token', body: 'same-token' },
  }])
  let before = batches(db)
  assertThrows(
    () => redact(db, both, 'same-token'),
    Error,
    'title and body',
  )
  assertEquals(batches(db), before)
  assertEquals(readComp(db, both, 'doc')?.body, 'same-token')
  assertThrows(
    () => redact(db, both, 'abc'),
    Error,
    'at least 4 characters',
  )
})

Deno.test('redact: a whole-column selector handles short values', () => {
  let db = bareDb()
  let target = uid()
  apply(db, [{
    eid: target,
    name: 'doc',
    comp: { title: 'x', body: 'body' },
  }])
  let out = redact(db, target, '.title')
  assertEquals(out.column, 'title')
  assertEquals(readComp(db, target, 'doc')?.title, '[redacted]')
  assert(batches(db).every((batch) => !batch.includes('"title":"x"')))
})

Deno.test('redact: a failed audit append rolls every copy back', () => {
  let db = bareDb()
  let target = uid()
  let secret = 'rollback-credential-12696'
  apply(db, [{
    eid: target,
    name: 'doc',
    comp: { title: 'Target', body: secret },
  }])
  db.prepare(
    `insert into embedding (eid, model, hash, vec) values (?, 'm', 'h', ?)`,
  ).run(target, new Uint8Array([1, 2, 3, 4]))
  let before = batches(db)
  db.exec(`
    create trigger fail_redaction_journal before insert on journal
    when exists (select 1 from redaction)
    begin
      select raise(abort, 'forced journal failure');
    end
  `)

  assertThrows(
    () => redact(db, target, secret),
    Error,
    'forced journal failure',
  )
  assertEquals(readComp(db, target, 'doc')?.body, secret)
  assertEquals(batches(db), before)
  assertEquals(
    db.prepare('select count(*) as n from embedding where eid = ?').get(target),
    { n: 1 },
  )
  assertEquals(db.prepare('select count(*) as n from redaction').get(), {
    n: 0,
  })
})

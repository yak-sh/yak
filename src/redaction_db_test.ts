// Redaction's database contract: live and historical content disappear in one
// act, derived copies cannot answer with it, and the hash-only audit persists.
import { assert, assertEquals, assertThrows } from '@std/assert'

Deno.env.set('DB_PATH', ':memory:')

let {
  apply,
  collectBlobText,
  cursorOf,
  inverseBatch,
  journalOf,
  lastBatch,
  readComp,
  redact,
  search,
  sha,
  textBlob,
} = await import('./db.ts')
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

// The normalized journal holds the same content and every history/replay reader
// now reads it (T-18880), so redaction must scrub journal_field too or the value
// leaks through the new door. Prove it disappears from the normalized rows and
// from what journalOf reconstructs, not just the JSON batch.
Deno.test('redact: scrubs the normalized journal_field, so the new readers cannot leak it', () => {
  let db = bareDb()
  let target = uid()
  let secret = 'normalized-needle-51873'
  apply(db, [{
    eid: target,
    name: 'doc',
    comp: { title: 'Target', body: `keep ${secret} keep` },
  }])
  // The value is in journal_field before redaction.
  let fieldHits = () =>
    (db.prepare(
      `select count(*) as n from journal_field where instr(value, ?) > 0`,
    ).get(secret) as { n: number }).n
  assert(fieldHits() > 0)

  redact(db, target, secret)

  // Gone from the normalized after-images, and from what the reader rebuilds.
  assertEquals(fieldHits(), 0)
  let bodies = journalOf(db, target).flatMap((e) =>
    e.changes.filter((c) => c.name == 'doc').map((c) =>
      (c.comp as { body?: string } | null)?.body ?? ''
    )
  )
  assert(bodies.every((b) => !b.includes(secret)))
  assert(bodies.some((b) => b.includes('[redacted]')))
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

// blob_text is the content-addressed backend doc.body resolves through, and the
// backup dumps it as text (M-17879) — so forgetting a body that is not shared
// must COLLECT its now-unreferenced blob or the value survives in the CAS store.
// Prove the bytes leave blob_text (D-18862 shared-reference GC).
Deno.test('redact: forgets the content-addressed body, collecting the unreferenced blob', () => {
  let db = bareDb()
  let target = uid()
  let secret = 'blob-needle-84421'
  apply(db, [{
    eid: target,
    name: 'doc',
    comp: { title: 'T', body: `hold ${secret} hold` },
  }])
  let inText = () =>
    (db.prepare(
      `select count(*) as n from blob_text where instr(value, ?) > 0`,
    ).get(secret) as { n: number }).n
  let oldBlob = sha(`hold ${secret} hold`)
  assert(inText() > 0)

  redact(db, target, secret)

  assertEquals(inText(), 0) // gone from the CAS backend, not just the doc row
  assertEquals(
    (db.prepare(
      `select count(*) as n from blob_text
       where entity = (select id from entity where eid = ?)`,
    ).get(oldBlob) as { n: number }).n,
    0, // the orphaned blob's text is collected
  )
  assertEquals(readComp(db, target, 'doc')?.body, 'hold [redacted] hold')
  assertEquals(search(db, secret), [])
})

// GC removes references first and collects only the unreferenced (D-18864). Two
// docs sharing one body dedup to ONE blob; forgetting one repoints it to a clean
// blob while the other keeps the shared value, so the shared blob has a live
// referrer and must NEVER be collected.
Deno.test('redact: a body two docs share survives forgetting one', () => {
  let db = bareDb()
  let a = uid()
  let b = uid()
  let secret = 'shared-needle-33112'
  let body = `dual ${secret} dual`
  apply(db, [{ eid: a, name: 'doc', comp: { title: 'A', body } }])
  apply(db, [{ eid: b, name: 'doc', comp: { title: 'B', body } }])
  let bodyId = (eid: string) =>
    (db.prepare(
      `select body from doc where entity = (select id from entity where eid = ?)`,
    ).get(eid) as { body: number }).body
  let shared = bodyId(a)
  assertEquals(bodyId(b), shared) // structural dedup: one blob, two referrers

  redact(db, a, secret)

  assertEquals(readComp(db, a, 'doc')?.body, 'dual [redacted] dual')
  assertEquals(readComp(db, b, 'doc')?.body, body) // B legitimately keeps it
  assertEquals(
    (db.prepare('select count(*) as n from blob_text where entity = ?')
      .get(shared) as { n: number }).n,
    1, // still referenced by B, so the value is not collected
  )
})

// The general safe collector (deferred from T-18875): an unreferenced text value
// is collectable, a referenced one never is.
Deno.test('collectBlobText: collects an orphan value, never a referenced one', () => {
  let db = bareDb()
  let referenced = uid()
  apply(db, [{
    eid: referenced,
    name: 'doc',
    comp: { title: 'R', body: 'kept body' },
  }])
  let kept = sha('kept body')
  let orphan = sha('orphan body')
  textBlob(db, 'orphan body') // a text blob nothing references
  let has = (eid: string) =>
    (db.prepare(
      `select count(*) as n from blob_text
       where entity = (select id from entity where eid = ?)`,
    ).get(eid) as { n: number }).n
  assertEquals(has(orphan), 1)
  assertEquals(has(kept), 1)

  let collected = collectBlobText(db)

  assert(collected.includes(orphan))
  assert(!collected.includes(kept))
  assertEquals(has(orphan), 0) // unreferenced → collected
  assertEquals(has(kept), 1) // doc.body referrer → never collected
})

// Concurrency safety, its observable half: a value that becomes referenced AFTER
// collection is safely restored through textBlob's insert-or-ignore, so a writer
// racing a collection can never leave a doc.body pointing at absent content. The
// serialization half (begin immediate) is argued at collectBlobText.
Deno.test('collectBlobText: a value referenced after collection re-lands intact', () => {
  let db = bareDb()
  let orphan = sha('racy body')
  textBlob(db, 'racy body')
  let has = () =>
    (db.prepare(
      `select count(*) as n from blob_text
       where entity = (select id from entity where eid = ?)`,
    ).get(orphan) as { n: number }).n
  assert(collectBlobText(db, [orphan]).includes(orphan))
  assertEquals(has(), 0)

  let d = uid()
  apply(db, [{ eid: d, name: 'doc', comp: { title: 'D', body: 'racy body' } }])
  assertEquals(readComp(db, d, 'doc')?.body, 'racy body') // no dangling reference
  assertEquals(has(), 1) // content re-landed under the same content hash
})

// Predecessor chain + transaction preservation (D-18861/D-18864): a mid-history
// redaction rewrites VALUES in place; it deletes no tx/change/field rows, so
// history stays navigable and reconstruction reports [redacted], never the secret.
Deno.test('redact: mid-history redaction keeps the field chain consistent and the tx structure intact', () => {
  let db = bareDb()
  let target = uid()
  let secret = 'history-needle-71002'
  apply(db, [{
    eid: target,
    name: 'doc',
    comp: { title: 'T', body: `first ${secret}` },
  }])
  apply(db, [{ eid: target, name: 'doc', comp: { body: 'second clean' } }])
  apply(db, [{ eid: target, name: 'doc', comp: { body: `third ${secret}` } }])
  let txCount = () =>
    (db.prepare('select count(*) as n from journal_tx').get() as { n: number })
      .n
  let bodyFields = () =>
    (db.prepare(
      `select count(*) as n from journal_field jf
         join journal_change jc on jc.id = jf.change
       where jc.eid = ? and jc.component = 'doc' and jf.field = 'body'`,
    ).get(target) as { n: number }).n
  let tx0 = txCount()
  let bf0 = bodyFields() // one after-image per body edit — the predecessor chain

  redact(db, target, secret)

  // Transaction preservation: only the audit tx is ADDED; the three body
  // after-images are rewritten in place (audit's own docChange adds exactly one).
  assertEquals(txCount(), tx0 + 1)
  assertEquals(bodyFields(), bf0 + 1)
  // Reconstruction is consistent: no history row resurrects the secret, the
  // untouched edit is intact, and both secret-bearing edits read [redacted].
  let bodies = journalOf(db, target).flatMap((e) =>
    e.changes.filter((c) => c.name == 'doc').map((c) =>
      (c.comp as { body?: string } | null)?.body ?? ''
    )
  )
  assert(bodies.every((b) => !b.includes(secret)))
  assert(bodies.includes('second clean'))
  assert(bodies.filter((b) => b.includes('[redacted]')).length >= 2)
  assertEquals(readComp(db, target, 'doc')?.body, 'third [redacted]')
})

// Cursor invalidation (D-18864): the redaction journals a forward transaction, so
// cursorOf advances and every returning client's since-delta / live cast carries
// the sanitized value over the one it cached — the append-forward path, not an
// epoch bump (which would not reach the per-worker read connections).
Deno.test('redact: advances the cursor with the sanitized forward change', () => {
  let db = bareDb()
  let target = uid()
  let secret = 'cursor-needle-55019'
  apply(db, [{
    eid: target,
    name: 'doc',
    comp: { title: 'T', body: `x ${secret} x` },
  }])
  let before = cursorOf(db)

  redact(db, target, secret)

  assert(cursorOf(db) > before) // a new tx: returning clients delta past it
  let forward = journalOf(db, target)[0].changes
    .filter((c) => c.name == 'doc')
    .map((c) => (c.comp as { body?: string } | null)?.body)
  assert(forward.some((b) => b === 'x [redacted] x'))
  assert(forward.every((b) => !b?.includes(secret)))
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

// A historically-torn journal row (row #2106568; T-24020) whose batch is not
// parseable JSON must not break redaction: the scrubber skips + warns on it,
// exactly as the backfill does, and still removes the secret from every good
// row and from live state.
Deno.test('redact: a corrupt (unparseable) journal row is skipped, not fatal', () => {
  let db = bareDb()
  let target = uid()
  let secret = 'torn-secret-24020'
  apply(db, [{
    eid: target,
    name: 'doc',
    comp: { title: 'Target', body: `keep ${secret} keep` },
  }])
  // Raw bytes straight into the column: the secret is present (so redactionRows'
  // instr() pre-screen selects the row) but a control char makes it invalid JSON.
  db.prepare(
    'insert into journal (ts, actor, via, batch, trace) values (?, ?, ?, ?, ?)',
  ).run(
    '2026-01-01T00:00:00.000Z',
    null,
    null,
    '[{"eid":"' + target + '","name":"doc","comp":{"body":"' + secret +
      String.fromCharCode(1) + '"}}]',
    null,
  )

  let warned: string[] = []
  let realWarn = console.warn
  console.warn = (...a: unknown[]) => warned.push(String(a[0]))
  let out
  try {
    out = redact(db, target, secret)
  } finally {
    console.warn = realWarn
  }

  // Live state and every PARSEABLE batch are scrubbed …
  assertEquals(out.column, 'body')
  assertEquals(readComp(db, target, 'doc')?.body, 'keep [redacted] keep')
  // … while the one torn row is left untouched (an honest gap the JSON readers
  // skip), and the skip was WARNED, not thrown.
  assert(warned.some((w) => w.includes('skipping unparseable batch')))
  let corrupt = db.prepare(
    `select batch from journal where instr(batch, char(1)) > 0`,
  ).get() as { batch: string }
  assert(corrupt.batch.includes(secret))
})

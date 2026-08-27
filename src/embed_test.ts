// embed.ts's pure seams against an in-memory db: what counts as stale,
// how neighbors rank, and the hash that names an embedding. The model
// itself never loads here — a test suite that downloads 30MB isn't one.
// Ranking rides the real vector extension: `vec(1, 0)` fixtures ride a dense
// basis (testvec.ts) so the ANN index quantizes them like real embeddings.
Deno.env.set('DB_PATH', ':memory:')
let { db } = await import('./live_db.ts')
let { textBlob } = await import('./db.ts')
let { vectorDb } = await import('./testdb.ts')
let { hash, MODEL, prune, similar, similarTo, stale, stored, textOf } =
  await import('./embed.ts')
let { ownVector, refreshVector } = await import('./vector.ts')
// This test process is the sole writer of its own :memory: graph, so it owns
// the quantize the way the embed sweep's process does (T-22622).
ownVector()
let { axes } = await import('./testvec.ts')
let { slow } = await import('./testing.ts')
let { assertEquals } = await import('@std/assert')

let uid = (): string => crypto.randomUUID()
// Component tables are keyed by the integer `entity` spine id now; eids stay the
// wire identity, so raw SQL translates at the boundary. (`embedding` is derived
// data, still keyed by its own `eid` — left untouched.)
let OWNED = `entity = (select id from entity where eid = ?)`
let idOf = `(select id from entity where eid = ?)`
let doc = (eid: string, title: string, body = '') => {
  db.prepare(
    'insert into entity (eid, num) values (?, ?)',
  ).run(eid, Math.floor(Math.random() * 1e9))
  db.prepare(`insert into doc (entity, title, body) values (${idOf}, ?, ?)`)
    .run(
      eid,
      title,
      textBlob(db, body),
    )
}
let vec = (...xs: number[]) => axes(...xs)
// Store a vector the way the sweep does — write, then rebuild the ANN index.
// The rebuild is not optional here: knn() is strictly read-only (T-22622), so
// an unquantized write is invisible to similar() until its owner quantizes it.
let put = (eid: string, text: string, v: Float32Array) => {
  db.prepare(
    'insert into embedding (eid, model, hash, vec) values (?, ?, ?, ?)',
  ).run(eid, MODEL, hash(text), new Uint8Array(v.buffer))
  refreshVector(db)
}

Deno.test('hash: stable for same text, moved by any edit', () => {
  assertEquals(hash('a title\nbody'), hash('a title\nbody'))
  assertEquals(hash('a title\nbody') == hash('a title\nbody.'), false)
})

Deno.test('textOf: title+body, trimmed, cut at the model horizon', () => {
  assertEquals(textOf('T', 'b'), 'T\nb')
  assertEquals(textOf('T', null), 'T')
  assertEquals(textOf('', ''), '')
  assertEquals(textOf('x', 'y'.repeat(9000)).length, 2000)
})

Deno.test('stale: unembedded and text-moved docs owe; fresh do not', () => {
  let [a, b, c] = [uid(), uid(), uid()]
  doc(a, 'never embedded')
  doc(b, 'embedded and unchanged')
  doc(c, 'embedded then edited')
  put(b, textOf('embedded and unchanged', ''), vec(1, 0))
  put(c, textOf('an older text', ''), vec(0, 1))
  let owed = stale(db).map((r) => r.eid)
  assertEquals(owed.includes(a), true)
  assertEquals(owed.includes(b), false)
  assertEquals(owed.includes(c), true)
  assertEquals(stale(db, 1).length, 1)
})

Deno.test('stale: comments, empty docs, and quarantine never owe', () => {
  let [c, e, q] = [uid(), uid(), uid()]
  doc(c, 'a comment body')
  db.prepare(`insert into comment (entity, target) values (${idOf}, ${idOf})`)
    .run(c, c)
  doc(e, '', '')
  doc(q, 'unsafe')
  db.prepare(`insert into quarantined (entity) values (${idOf})`).run(q)
  let owed = stale(db).map((r) => r.eid)
  assertEquals(owed.includes(c), false)
  assertEquals(owed.includes(e), false)
  assertEquals(owed.includes(q), false)
})

// Pruning used to ask only whether a doc row existed, while stale() asked
// three things — so a doc that was emptied, or that gained a comment, kept
// a vector the sweep would never refresh again.
Deno.test('prune: every route out of eligibility takes its vector along', () => {
  let [live, emptied, spoke, dead] = [uid(), uid(), uid(), uid()]
  doc(live, 'still a doc with text')
  doc(emptied, 'about to be emptied')
  doc(spoke, 'about to become a comment')
  doc(dead, 'about to be deleted')
  for (
    let [eid, text] of [
      [live, 'still a doc with text'],
      [emptied, 'about to be emptied'],
      [spoke, 'about to become a comment'],
      [dead, 'about to be deleted'],
    ]
  ) put(eid, text, vec(1, 0))

  db.prepare(`update doc set title = '', body = ? where ${OWNED}`)
    .run(textBlob(db, ''), emptied)
  db.prepare(`insert into comment (entity, target) values (${idOf}, ${idOf})`)
    .run(
      spoke,
      spoke,
    )
  db.prepare(`delete from doc where ${OWNED}`).run(dead)

  prune(db)
  let held = (eid: string) =>
    !!db.prepare('select eid from embedding where eid = ?').get(eid)
  assertEquals([held(live), held(emptied), held(spoke), held(dead)], [
    true,
    false,
    false,
    false,
  ])
})

// A vector outlives its entity until the next sweep. The web's Similar
// section screens hits through the live cache; the dupe hint cannot, so it
// saw bare UUIDs for entities that were already gone.
slow('similar: an ineligible row never answers, swept or not', () => {
  let [alive, gone, quarantined] = [uid(), uid(), uid()]
  doc(alive, 'a living neighbour')
  doc(gone, 'a doomed neighbour')
  doc(quarantined, 'an unsafe neighbour')
  put(alive, 'a living neighbour', vec(1, 0))
  put(gone, 'a doomed neighbour', vec(1, 0))
  put(quarantined, 'an unsafe neighbour', vec(1, 0))
  db.prepare(`delete from doc where ${OWNED}`).run(gone)
  db.prepare(`insert into quarantined (entity) values (${idOf})`).run(
    quarantined,
  )

  let hits = similar(db, vec(1, 0), 99, 0.5).map((h) => h.eid)
  assertEquals(
    [hits.includes(alive), hits.includes(gone), hits.includes(quarantined)],
    [true, false, false],
  )
})

Deno.test('stored: exact text reuses a doc vector; edits and misses do not', () => {
  let eid = uid()
  let text = 'already embedded'
  doc(eid, text)
  put(eid, text, vec(3, 4))
  assertEquals([...stored(db, eid, text)!], [...vec(3, 4)])
  assertEquals(stored(db, eid, 'edited'), null)
  assertEquals(stored(db, uid(), text), null)
  db.prepare("update embedding set model = 'older' where eid = ?").run(eid)
  assertEquals(stored(db, eid, text), null)
})

slow('similarTo: a matching doc row needs no embedder', async () => {
  let eid = uid()
  let text = 'stored query'
  doc(eid, text)
  put(eid, text, vec(1, 0))
  let hits = await similarTo(db, text, 99, 0, eid)
  assertEquals(hits?.some((h) => h.eid == eid), true)
})

slow('similar: dot-ranked, floored, limited', () => {
  let [x, y, z] = [uid(), uid(), uid()]
  doc(x, 'east')
  doc(y, 'northeast')
  doc(z, 'north')
  put(x, 'east', vec(1, 0))
  put(y, 'northeast', vec(1, 1))
  put(z, 'north', vec(0, 1))
  let hits = similar(db, vec(1, 0), 8, 0.5)
  assertEquals(
    hits.filter((h) => [x, y, z].includes(h.eid)).map((h) => h.eid),
    [
      x,
      y,
    ],
  ) // z scores 0 — floored out; x (1.0) outranks y (~0.71)
  // the shared :memory: db holds other tests' vectors — screen to ours
  let top = similar(db, vec(1, 0), 99, 0)
    .filter((h) => [x, y, z].includes(h.eid))
  assertEquals(top[0].eid, x)
})

// A model bump invalidates the corpus and the async sweep replaces it row by
// row; during that window old and new vectors are incomparable spaces. similar()
// passes MODEL to knn(), which screens the scan to the active space — so an
// old-model row at the very query position never ranks (D-22781).
slow(
  'similar: the KNN model filter screens a foreign embedding space out',
  () => {
    let [mine, foreign] = [uid(), uid()]
    doc(mine, 'active-space neighbour')
    doc(foreign, 'foreign-space neighbour')
    put(mine, 'active-space neighbour', vec(1, 0)) // stored under the active MODEL
    // A row from a DIFFERENT model at the SAME position — the mixed-space hazard.
    db.prepare(
      'insert into embedding (eid, model, hash, vec) values (?, ?, ?, ?)',
    )
      .run(
        foreign,
        'Xenova/bge-small-en-v1.5',
        'h',
        new Uint8Array(vec(1, 0).buffer),
      )
    refreshVector(db)
    let hits = similar(db, vec(1, 0), 99, 0.5).map((h) => h.eid)
    assertEquals(hits.includes(mine), true)
    assertEquals(hits.includes(foreign), false)
  },
)

// A re-embed writes in place (same rowid) and must answer with the NEW vector
// once the index is rebuilt. The rebuild is the SWEEP's, never the reader's:
// knn() is strictly read-only (T-22525/T-22622), so this drives refreshVector
// explicitly where embedSweep would, and the stale answer BEFORE it is the
// documented degrade — staler neighbours, never a write on the read path.
slow('similar: an in-place re-embed answers with the new vector', () => {
  let d = vectorDb()
  let e = uid()
  d.prepare('insert into entity (eid, num) values (?, ?)')
    .run(e, Math.floor(Math.random() * 1e9))
  d.prepare(`insert into doc (entity, title, body) values (${idOf}, ?, ?)`)
    .run(e, 'generation probe', textBlob(d, ''))
  let store = (v: Float32Array) =>
    d.prepare(
      `insert into embedding (eid, model, hash, vec) values (?, ?, ?, ?)
       on conflict (eid) do update set vec = excluded.vec`,
    ).run(
      e,
      MODEL,
      hash('generation probe'),
      new Uint8Array(v.buffer),
    )
  let score = () =>
    Math.round(
      (similar(d, vec(1, 0), 9, -2).find((h) => h.eid == e)?.score ?? -9) * 100,
    )
  store(vec(1, 0))
  refreshVector(d)
  assertEquals(score(), 100) // query IS the stored vector → cosine 1.0
  store(vec(0, 1)) // re-embed in place, orthogonal to the query
  assertEquals(score(), 100) // read-only knn still answers the old quantization
  refreshVector(d) // the sweep's rebuild — the only thing that may write
  assertEquals(score(), 0) // the index rebuilt: the new vector answers
})

// PARITY: the SQL KNN must return the neighbours the deleted JS cosine scan
// would have. `jsScan` is that removed algorithm, kept here as the reference —
// read every vector, dot against the query, sort, screen the living head. On an
// isolated corpus of well-separated directions the ANN order matches it
// exactly, and each score matches the exact cosine to a few thousandths.
slow('similar: SQL KNN ranks the same neighbours the JS scan did', () => {
  let d = vectorDb()
  let store = (title: string, v: Float32Array) => {
    let e = uid()
    d.prepare('insert into entity (eid, num) values (?, ?)')
      .run(e, Math.floor(Math.random() * 1e9))
    d.prepare(`insert into doc (entity, title, body) values (${idOf}, ?, ?)`)
      .run(e, title, textBlob(d, ''))
    d.prepare(
      'insert into embedding (eid, model, hash, vec) values (?, ?, ?, ?)',
    )
      .run(e, MODEL, hash(title), new Uint8Array(v.buffer))
    return e
  }
  // Distinct cosines to axes(1, 0), well separated so no near-tie can flip.
  let want: [string, number][] = [
    ['a', 0.95],
    ['b', 0.8],
    ['c', 0.6],
    ['d', 0.4],
    ['e', 0.15],
  ]
  let mine = new Set(
    want.map(([t, c]) => store(t, vec(c, Math.sqrt(1 - c * c)))),
  )
  refreshVector(d) // the sweep's rebuild — knn() itself never writes

  // The deleted JS scan, verbatim in spirit: exact cosine over every stored
  // vector, sorted, living head.
  let jsScan = (q: Float32Array, k: number) =>
    (d.prepare('select eid, vec from embedding').all() as {
      eid: string
      vec: Uint8Array
    }[])
      .map((r) => {
        let m = new Float32Array(r.vec.slice().buffer)
        let s = 0
        for (let i = 0; i < q.length; i++) s += q[i] * m[i]
        return { eid: r.eid, score: s }
      })
      .filter((h) => mine.has(h.eid))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)

  let q = vec(1, 0)
  let sql = similar(d, q, 5, 0).filter((h) => mine.has(h.eid))
  let js = jsScan(q, 5)
  // Same neighbours, same order.
  assertEquals(sql.map((h) => h.eid), js.map((h) => h.eid))
  // Same scores: the ANN quantization tracks the exact cosine to ~0.005.
  for (let i = 0; i < js.length; i++) {
    assertEquals(Math.abs(sql[i].score - js[i].score) < 0.02, true)
  }
})

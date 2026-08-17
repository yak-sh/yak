// Semantic vectors beside FTS (T-3640, first slice): a local embedder —
// bge-small over onnx via transformers.js, resident in the server
// process — keeps one vector per non-comment doc, so a creation reply
// can say "this already exists" (the dupe hint) and search can one day
// bridge vocabulary. Everything here is DERIVED data: the sweep
// (re)embeds docs whose text hash moved and prunes the dead, similar()
// is a cosine over the model's vectors packed into one contiguous cache
// (rebuilt only when the table changes — a full brute-force scan still,
// O(relevant-subset) restriction is T-18121's next layer), and a box
// without the model just has no hints — the embedder dies once, quietly,
// and every door degrades to silence. apply() never waits on any of this.
import type { DatabaseSync } from './sqlite.ts'
import { DIM, refreshVector } from './vector.ts'

export let MODEL = 'Xenova/bge-small-en-v1.5'

// What a doc's vector means: title and body as one text, cut at the
// model's horizon (bge reads ~512 tokens; beyond ~2KB is silence anyway).
export let textOf = (title: unknown, body: unknown) =>
  `${String(title ?? '')}\n${String(body ?? '')}`.trim().slice(0, 2000)

// FNV-1a over model+text — names the exact embedding a row holds, so the
// sweep can skip the unchanged without storing the text twice.
export let hash = (text: string) => {
  let h = 2166136261
  for (let s = `${MODEL}\n${text}`, i = 0; i < s.length; i++) {
    h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0
  }
  return h.toString(36)
}

// The resident pipeline: one lazy init, one verdict. A failed init (no
// package, no network for the model download) marks the embedder dead
// for the process — warn once, never retry-loop, never throw upward.
type Extractor = (
  text: string,
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array }>
let pipe: Extractor | null = null
let dead = false
let boot: Promise<void> | null = null
let init = () =>
  boot ??= (async () => {
    // The model is 400MB and ~6s to load. A test never wants it (embed_test
    // uses precomputed vectors), so TASKS_EMBED=0 marks the embedder dead
    // before the import — every dupe-hint path degrades to silence, exactly
    // as it does on a box that lacks the package. Production leaves it unset.
    if (Deno.env.get('TASKS_EMBED') === '0') {
      dead = true
      return
    }
    try {
      let { env, pipeline } = await import('@huggingface/transformers') // The default model cache is INSIDE the npm package dir — a cache
       // clean or a version bump silently costs a 34MB re-download at
      // boot. Pin it somewhere that survives both. (~/.tasks is a git
      // repo — a re-downloadable model has no place in backups.)
      ;(env as { cacheDir: string }).cacheDir = `${
        Deno.env.get('HOME')
      }/.cache/tasks/models`
      pipe = await (pipeline as (
        task: string,
        model: string,
        opts: { dtype: string },
      ) => Promise<Extractor>)('feature-extraction', MODEL, { dtype: 'q8' })
    } catch (e) {
      dead = true
      console.warn('embed: no embedder —', (e as Error).message)
    }
  })()

export let embed = async (text: string): Promise<Float32Array | null> => {
  await init()
  if (!pipe) return null
  let out = await pipe(text.slice(0, 2000), {
    pooling: 'mean',
    normalize: true,
  })
  return Float32Array.from(out.data)
}

// SQLite's trim() strips spaces only, so name the whitespace JS trims —
// the rule below and textOf have to agree on what "empty" means.
let WS = ' \t\n\r\v\f'

// The one rule for what should hold a vector: doc-bearing, not a comment,
// carrying text. Every reader below asks THIS clause — stale() embeds
// exactly these, prune() keeps exactly these, similar() answers for exactly
// these — so an emptied doc, a doc that became a comment, and a deleted
// entity all leave together, and no door can drift from another.
// Correlated on purpose: `not exists` probes the comment index for the one
// row at hand, so the same clause is cheap swept over every doc AND asked of
// a single eid — one rule, never a second phrasing to fall out of step.
let ELIGIBLE = `not exists (select 1 from comment where comment.eid = doc.eid)
       and not exists (
         select 1 from quarantined where quarantined.eid = doc.eid
       )
       and trim(coalesce(doc.title,'') || coalesce(doc.body,''), ?) != ''`

let lives = (db: DatabaseSync, eid: string) =>
  !!db.prepare(`select eid from doc where eid = ? and ${ELIGIBLE}`)
    .get(eid, WS)

// The docs owed a (re)embedding: eligible, and whose stored hash no longer
// names their text. Pure SQL + hash — the testable half of the sweep.
export let stale = (db: DatabaseSync) =>
  (db.prepare(
    `select d.eid, d.title, d.body, e.hash as had from doc d
     left join embedding e on e.eid = d.eid
     where d.eid in (select eid from doc where ${ELIGIBLE})`,
  ).all(WS) as {
    eid: string
    title: string
    body: string
    had: string | null
  }[])
    .map((r) => ({ ...r, text: textOf(r.title, r.body) }))
    .filter((r) => r.text && hash(r.text) != r.had)

// Bumped on every in-place write this module makes to the table. An upsert
// re-embed (put) keeps the eid's rowid AND the row count, so similar()'s cache
// signature can't see it by counting rows; this generation can. Deletes already
// move the count, but bumping here too keeps one rule. A stale cache costs
// recall, never correctness — similar() still screens its head through lives().
let writes = 0

// Rows for the ineligible: an entity deleted, a doc emptied, a doc that
// became a comment. Pruning reads the SAME rule stale() embeds by, so the
// table can never keep a vector the sweep would never refresh.
export let prune = (db: DatabaseSync) => {
  writes++
  return db.prepare(
    `delete from embedding
     where eid not in (select eid from doc where ${ELIGIBLE})`,
  ).run(WS)
}

let put = (db: DatabaseSync, eid: string, text: string, vec: Float32Array) => {
  writes++
  return db.prepare(
    `insert into embedding (eid, model, hash, vec)
     values (?, ?, ?, vector_as_f32(?, ?))
     on conflict (eid) do update set
       model = excluded.model, hash = excluded.hash, vec = excluded.vec,
       at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(eid, MODEL, hash(text), new Uint8Array(vec.buffer), DIM)
}

// The sweep: prune, then embed what's owed, one at a time — each await
// yields the event loop, so a 2k-doc backfill never starves the server.
// Interval-safe like the others: one sweep in flight, failures warn.
let sweeping = false
export let embedSweep = async (db: DatabaseSync) => {
  if (sweeping || dead) return 0
  sweeping = true
  let n = 0
  try {
    prune(db)
    for (let r of stale(db)) {
      let vec = await embed(r.text)
      if (!vec) break // the embedder died mid-sweep — stop quietly
      put(db, r.eid, r.text, vec)
      n++
    }
    refreshVector(db)
    if (n) console.log(`embed sweep: ${n} fresh`)
  } catch (e) {
    console.warn('embed sweep —', e)
  } finally {
    sweeping = false
  }
  return n
}

// The twin floor, measured on the live graph (2026-07-22): an exact
// copy scores 1.0, a reworded twin ~0.83, a close sibling ~0.81, a
// same-domain different fact ~0.68 — 0.78 catches the twins (with
// margin for terser rewordings) and admits the odd sibling worth a
// look, while topic-mates stay out. Every similar door shares it: the
// dupe hint (client.ts) and the doc view's Similar section.
export let FLOOR = 0.78

// The model's vectors packed once into one contiguous Float32Array, held per db
// handle. The dot below then streams cache-friendly memory instead of what cost
// ~90% of similar()'s time (22ms → 3.5ms over the live 7.6k-vector corpus):
// re-fetching ~12MB of blobs and allocating a fresh Float32Array view per row,
// on every call. Rebuilt only when the signature moves.
type VecCache = { sig: string; eids: string[]; mat: Float32Array; dim: number }
let caches = new WeakMap<DatabaseSync, VecCache>()

// Cheap staleness signature: the row count (any insert or delete moves it — one
// covering btree count, ~0.01ms) plus the write generation (an upsert re-embed
// keeps count and rowid, so only this catches it). max(at) would catch it too
// but reads every row's timestamp (~5ms), defeating the point.
let sigOf = (db: DatabaseSync): string => {
  let r = db.prepare('select count(*) c from embedding where model = ?')
    .get(MODEL) as { c: number }
  return `${r.c}:${writes}`
}

let matrix = (db: DatabaseSync): VecCache => {
  let sig = sigOf(db)
  let hit = caches.get(db)
  if (hit && hit.sig == sig) return hit
  let rows = db.prepare('select eid, vec from embedding where model = ?')
    .all(MODEL) as { eid: string; vec: Uint8Array }[]
  let n = rows.length
  let dim = n ? rows[0].vec.length / 4 : 0
  let mat = new Float32Array(n * dim)
  let eids = new Array<string>(n)
  for (let i = 0; i < n; i++) {
    eids[i] = rows[i].eid
    // slice() re-homes the blob on a fresh, 4-aligned buffer — a view straight
    // over sqlite's bytes throws when the offset is odd. Paid once per build.
    mat.set(new Float32Array(rows[i].vec.slice().buffer, 0, dim), i * dim)
  }
  let fresh = { sig, eids, mat, dim }
  caches.set(db, fresh)
  return fresh
}

// Nearest stored vectors to a query vector — normalized both sides, so cosine
// is a dot product. Streams the cached matrix (row order preserved, so ties
// resolve exactly as the old per-row scan did); floor screens the noise before
// the caller ever sees it.
export let similar = (
  db: DatabaseSync,
  q: Float32Array,
  limit = 8,
  floor = 0,
) => {
  let { eids, mat, dim } = matrix(db)
  if (!dim) return []
  let L = Math.min(q.length, dim)
  let hits: { eid: string; score: number }[] = []
  for (let i = 0; i < eids.length; i++) {
    let base = i * dim
    let s = 0
    for (let k = 0; k < L; k++) s += q[k] * mat[base + k]
    if (s >= floor) hits.push({ eid: eids[i], score: s })
  }
  hits.sort((a, b) => b.score - a.score)
  // Screen the ranked HEAD, not the table: a vector outlives its entity
  // until the next sweep and must never answer (the web's Similar section
  // filters hits through the live cache, but the dupe hint has no cache to
  // filter through — it saw bare UUIDs for entities already gone). Dead
  // rows are rare, so this costs ~limit point lookups; folding the rule
  // into the fetch instead cost +75% on every call to screen out nothing.
  let live: typeof hits = []
  for (let h of hits) {
    if (live.length == limit) break
    if (lives(db, h.eid)) live.push(h)
  }
  return live
}

// A doc's row is reusable only while it names this model and exact text.
// A stale sweep row must never answer for freshly edited prose.
export let stored = (
  db: DatabaseSync,
  eid: string,
  text: string,
): Float32Array | null => {
  let row = db.prepare(
    'select vec from embedding where eid = ? and model = ? and hash = ?',
  ).get(eid, MODEL, hash(text)) as { vec: Uint8Array } | undefined
  return row ? new Float32Array(row.vec.slice().buffer) : null
}

// The whole door: text in, neighbors out — null when there is no
// embedder to ask (the caller shows nothing, never an error). A doc can
// name its stored vector; arbitrary text still visits the embedder.
export let similarTo = async (
  db: DatabaseSync,
  text: string,
  limit = 8,
  floor = 0,
  eid?: string,
) => {
  let vec = eid ? stored(db, eid, text) : null
  vec ??= await embed(text)
  return vec ? similar(db, vec, limit, floor) : null
}

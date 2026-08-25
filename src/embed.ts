// Semantic vectors beside FTS (T-3640, first slice): a local embedder —
// bge-small over onnx via transformers.js, resident in the server
// process — keeps one vector per non-comment doc, so a creation reply
// can say "this already exists" (the dupe hint) and search can one day
// bridge vocabulary. Everything here is DERIVED data: the sweep
// (re)embeds docs whose text hash moved and prunes the dead, similar()
// ranks neighbours with an indexed SQL KNN over the vector extension's
// persisted ANN index (vector.ts knn) — no JS cosine scan, no per-handle
// cache — and a box without the model just has no hints: the embedder dies
// once, quietly, and every door degrades to silence. apply() never waits on
// any of this.
import type { DatabaseSync } from './sqlite.ts'
import { DIM, knn, refreshVector } from './vector.ts'
// textOf and FLOOR live in twin.ts so the client may share them without pulling
// this server-only module (and its vector.ts extension loader) into the browser
// bundle. Re-exported here because embed.ts uses textOf internally and is the
// facade its server callers already import from.
import { FLOOR, textOf } from './twin.ts'
export { FLOOR, textOf }

export let MODEL = 'Xenova/bge-small-en-v1.5'

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
// The `embedding` table is DERIVED and stays keyed by the doc's EID (D-18866
// reshapes only graph tables; embedding refills from the sweep). `doc`, though,
// is now keyed by the owner int id, so every doc↔embedding bridge joins the
// spine to speak the eid the embedding rows hold. ELIGIBLE is correlated on the
// unaliased `doc` table, so it uses doc.entity for its sibling probes.
let ELIGIBLE =
  `not exists (select 1 from comment where comment.entity = doc.entity)
       and not exists (
         select 1 from quarantined where quarantined.entity = doc.entity
       )
       and trim(coalesce(doc.title,'') || coalesce(doc.body,''), ?) != ''`

let lives = (db: DatabaseSync, eid: string) =>
  !!db.prepare(
    `select o.eid as eid from doc join entity o on o.id = doc.entity
     where o.eid = ? and ${ELIGIBLE}`,
  )
    .get(eid, WS)

// The docs owed a (re)embedding: eligible, and whose stored hash no longer
// names their text. Pure SQL + hash — the testable half of the sweep.
export let stale = (db: DatabaseSync, limit = Infinity) =>
  (db.prepare(
    `select o.eid as eid, d.title, d.body, e.hash as had from doc d
     join entity o on o.id = d.entity
     left join embedding e on e.eid = o.eid
     where o.eid in (
       select o2.eid from doc join entity o2 on o2.id = doc.entity
       where ${ELIGIBLE}
     )`,
  ).all(WS) as {
    eid: string
    title: string
    body: string
    had: string | null
  }[])
    .map((r) => ({ ...r, text: textOf(r.title, r.body) }))
    .filter((r) => r.text && hash(r.text) != r.had)
    .slice(0, limit)

// Rows for the ineligible: an entity deleted, a doc emptied, a doc that
// became a comment. Pruning reads the SAME rule stale() embeds by, so the
// table can never keep a vector the sweep would never refresh.
export let prune = (db: DatabaseSync) =>
  db.prepare(
    `delete from embedding
     where eid not in (
       select o.eid from doc join entity o on o.id = doc.entity
       where ${ELIGIBLE}
     )`,
  ).run(WS)

let put = (db: DatabaseSync, eid: string, text: string, vec: Float32Array) =>
  db.prepare(
    `insert into embedding (eid, model, hash, vec)
     values (?, ?, ?, vector_as_f32(?, ?))
     on conflict (eid) do update set
       model = excluded.model, hash = excluded.hash, vec = excluded.vec,
       at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(eid, MODEL, hash(text), new Uint8Array(vec.buffer), DIM)

// The sweep: prune, then embed a bounded batch. An `await` only yields to the
// microtask queue when inference resolves, so an unbounded backfill can starve
// HTTP and retain inference state until V8's heap is exhausted. The batch is a
// fixed memory ceiling; a macrotask between rows keeps the server responsive.
// Interval-safe like the others: one sweep in flight, failures warn.
let sweeping = false
export let embedSweep = async (db: DatabaseSync, limit = 100) => {
  if (sweeping || dead) return 0
  sweeping = true
  let n = 0
  try {
    prune(db)
    for (let r of stale(db, limit)) {
      let vec = await embed(r.text)
      if (!vec) break // the embedder died mid-sweep — stop quietly
      put(db, r.eid, r.text, vec)
      n++
      await new Promise((resolve) => setTimeout(resolve, 0))
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

// A dead vector outlives its entity until the next sweep prunes it, so the ANN
// head can carry rows for entities already gone or turned ineligible, which
// lives() screens out below. knn() returns a fixed window, so over-fetch this
// many past `limit` to backfill the screened — dead rows are rare (bounded by
// deletions since the last sweep), and recall degrades gracefully if a
// pathological burst ever exhausts the slack.
let STALE_SLACK = 16

// Nearest stored vectors to a query vector, cosine-ranked, floored, and screened
// to the living — the vector extension's indexed KNN (vector.ts) does the rank
// in SQL, replacing the old JS cosine scan over a per-handle matrix cache. knn
// returns nearest-first, so the floor is a single break, and the head is
// screened through lives() exactly as the scan's was.
export let similar = (
  db: DatabaseSync,
  q: Float32Array,
  limit = 8,
  floor = 0,
) => {
  let live: { eid: string; score: number }[] = []
  for (let h of knn(db, q, limit + STALE_SLACK)) {
    if (h.score < floor) break
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

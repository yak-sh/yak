// Semantic vectors beside FTS (T-3640, first slice): a local embedder —
// bge-small over onnx via transformers.js, resident in the server
// process — keeps one vector per non-comment doc, so a creation reply
// can say "this already exists" (the dupe hint) and search can one day
// bridge vocabulary. Everything here is DERIVED data: the sweep
// (re)embeds docs whose text hash moved and prunes the dead, similar()
// is a brute-force cosine over the whole table (~8ms at 5k docs — an
// index earns its place around 50k), and a box without the model just
// has no hints — the embedder dies once, quietly, and every door
// degrades to silence. apply() never waits on any of this.
import type { DatabaseSync } from 'node:sqlite'

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

// The docs owed a (re)embedding: doc-bearing, non-comment, non-empty,
// whose stored hash no longer names their text. Pure SQL + hash — the
// testable half of the sweep.
export let stale = (db: DatabaseSync) =>
  (db.prepare(
    `select d.eid, d.title, d.body, e.hash as had from doc d
     left join embedding e on e.eid = d.eid
     where d.eid not in (select eid from comment)`,
  ).all() as { eid: string; title: string; body: string; had: string | null }[])
    .map((r) => ({ ...r, text: textOf(r.title, r.body) }))
    .filter((r) => r.text && hash(r.text) != r.had)

// Rows for the dead: embeddings whose doc is gone (entity deleted, or
// the doc emptied). Pruned by the sweep, so death needs no hook here.
let prune = (db: DatabaseSync) =>
  db.prepare('delete from embedding where eid not in (select eid from doc)')
    .run()

let put = (db: DatabaseSync, eid: string, text: string, vec: Float32Array) =>
  db.prepare(
    `insert into embedding (eid, model, hash, vec) values (?, ?, ?, ?)
     on conflict (eid) do update set
       model = excluded.model, hash = excluded.hash, vec = excluded.vec,
       at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(eid, MODEL, hash(text), new Uint8Array(vec.buffer))

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

// Nearest stored vectors to a query vector — normalized both sides, so
// cosine is a dot product. Brute force over every row of the model's
// vintage; floor screens the noise before the caller ever sees it.
export let similar = (
  db: DatabaseSync,
  q: Float32Array,
  limit = 8,
  floor = 0,
) => {
  let rows = db.prepare('select eid, vec from embedding where model = ?')
    .all(MODEL) as { eid: string; vec: Uint8Array }[]
  let hits: { eid: string; score: number }[] = []
  for (let r of rows) {
    // slice() re-homes the blob on a fresh, 4-aligned buffer — a view
    // straight over sqlite's bytes throws when the offset is odd.
    let v = new Float32Array(r.vec.slice().buffer, 0, q.length)
    let s = 0
    for (let i = 0; i < q.length; i++) s += q[i] * v[i]
    if (s >= floor) hits.push({ eid: r.eid, score: s })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
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

// Semantic vectors beside FTS (T-3640): embedding runs on the owner's GPU
// Ollama server (`ollama.yak.sh`, /api/embed) rather than in-process CPU —
// qwen3-embedding, MRL-truncated to DIM in the transport (ollama.ts) so the
// blob shape and the KNN index are unchanged (D-22781). We keep one vector per
// non-comment doc, so a creation reply can say "this already exists" (the dupe
// hint) and search can one day bridge vocabulary. Everything here is DERIVED
// data: the sweep (re)embeds docs whose text hash moved and prunes the dead,
// similar() ranks neighbours with an indexed SQL KNN over the vector extension's
// persisted ANN index (vector.ts knn) — no JS cosine scan. A box that cannot
// reach the embedder just has no hints: every door degrades to silence, but the
// fault is no longer invisible — it is stamped on embedHealth() and recorded to
// telemetry (M-16612). apply() never waits on any of this.
import type { Sql } from './store/sql.ts'
import { DIM, knn, refreshVector, vectorReady } from './vector.ts'
import { envConfig, type OllamaConfig, ollamaEmbed } from './ollama.ts'
import { resolve } from './config.ts'
import { record } from './telemetry.ts'
// textOf and FLOOR live in twin.ts so the client may share them without pulling
// this server-only module (and its vector.ts extension loader) into the browser
// bundle. Re-exported here because embed.ts uses textOf internally and is the
// facade its server callers already import from.
import { FLOOR, textOf } from './twin.ts'
export { FLOOR, textOf }

// The active embedding model, resolved OLLAMA_EMBED_MODEL override>env>default
// (config.ts). It folds into hash() and rides the `model` column, so a change
// invalidates every stored row and the KNN filter screens the old space out —
// the two must move together (D-22781). This is an ES module live binding: the
// server re-resolves it against the graph plane at boot via setModel(), and
// every importer (hash, put, stored, the KNN filter) sees the new value.
export let MODEL = resolve('OLLAMA_EMBED_MODEL', () => undefined).value!
export let setModel = (m: string) => MODEL = m

// The transport's config view (base + optional key), injected by the server so a
// saved OLLAMA_BASE_URL/OLLAMA_API_KEY override reaches the next embed with no
// restart. The default (envConfig) resolves env>default with no key — enough for
// a bare client or a test, which never reaches the network (TASKS_EMBED=0).
let config: OllamaConfig = envConfig
export let setEmbedConfig = (c: OllamaConfig) => config = c

// FNV-1a over model+text — names the exact embedding a row holds, so the
// sweep can skip the unchanged without storing the text twice.
export let hash = (text: string) => {
  let h = 2166136261
  for (let s = `${MODEL}\n${text}`, i = 0; i < s.length; i++) {
    h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0
  }
  return h.toString(36)
}

// A test never wants the network (embed_test uses precomputed vectors), so
// TASKS_EMBED=0 degrades every door to silence exactly as an unreachable box
// does. Production leaves it unset.
let off = () => Deno.env.get('TASKS_EMBED') === '0'

// Durable health (M-16612): the last embed transport fault, cleared by the next
// success. embed() still returns null on failure — the degrade-to-silence
// contract is intact — but the fault is no longer invisible: embedHealth()
// exposes it and the sweep records it to telemetry, a durable operator-visible
// log. `at` is when it last failed; null means the last attempt worked.
let health: { at: string; error: string } | null = null
export let embedHealth = () => health

// One vector for a text: the GPU box embeds it, the transport MRL-truncates to
// DIM. Returns null (silence) when embedding is off or the box is unreachable —
// the caller shows nothing, never an error — but a transport fault is stamped on
// health for the sweep to record. apply() never waits on this.
export let embed = async (text: string): Promise<Float32Array | null> => {
  if (off()) return null
  try {
    let vec = await ollamaEmbed(text.slice(0, 2000), MODEL, DIM, config)
    health = null
    return vec
  } catch (e) {
    health = { at: new Date().toISOString(), error: (e as Error).message }
    return null
  }
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
// The `embedding` table is DERIVED but keys on the doc's spine id like every
// other table, so doc↔embedding joins are int-to-int and only the door speaks
// the eid a caller holds. ELIGIBLE is correlated on the unaliased `doc` table,
// so it uses doc.entity for its sibling probes.
let ELIGIBLE =
  `not exists (select 1 from comment where comment.entity = doc.entity)
       and not exists (
         select 1 from quarantined where quarantined.entity = doc.entity
       )
       and trim(coalesce(doc.title,'') || coalesce(doc.body,''), ?) != ''`

let lives = (db: Sql, eid: string) =>
  !!db.prepare(
    `select o.eid as eid from doc_value doc join entity o on o.id = doc.entity
     where o.eid = ? and ${ELIGIBLE}`,
  )
    .get(eid, WS)

// The docs owed a (re)embedding: eligible, and whose stored hash no longer
// names their text. Pure SQL + hash — the testable half of the sweep.
export let stale = (db: Sql, limit = Infinity) =>
  (db.prepare(
    `select o.eid as eid, d.title, d.body, e.hash as had from doc_value d
     join entity o on o.id = d.entity
     left join embedding e on e.entity = d.entity
     where d.entity in (
       select doc.entity from doc_value doc where ${ELIGIBLE}
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
export let prune = (db: Sql) =>
  db.prepare(
    `delete from embedding
     where entity not in (select doc.entity from doc_value doc where ${ELIGIBLE})`,
  ).run(WS)

let put = (db: Sql, eid: string, text: string, vec: Float32Array) =>
  db.prepare(
    `insert into embedding (entity, model, hash, vec)
     values ((select id from entity where eid = ?), ?, ?, vector_as_f32(?, ?))
     on conflict (entity) do update set
       model = excluded.model, hash = excluded.hash, vec = excluded.vec,
       at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(eid, MODEL, hash(text), new Uint8Array(vec.buffer), DIM)

// The sweep: prune, then re-embed every doc whose text hash moved. Embedding is
// a REMOTE call now (ollama.ts), so the sweep holds no in-process inference
// state and has no V8-heap ceiling — the old fixed batch cap of 100 WAS that
// ceiling (a resident onnx model retaining state per row), and it is gone. What
// keeps the server responsive is the macrotask yielded between rows; the remote
// round-trip already yields the microtask queue. So the sweep drains its whole
// backlog in one responsive pass — a model bump invalidates the corpus and this
// clears all of it, ~one embed round-trip per doc, off the write path. The limit
// stays a parameter for a caller that wants a bounded slice, but defaults to the
// full backlog. Interval-safe like the others: one sweep in flight, failures warn.
let sweeping = false
export let embedSweep = async (db: Sql, limit = Infinity) => {
  // put() stores vectors through the extension's vector_as_f32, so with the
  // extension unavailable there is nothing the sweep can safely do — skip it
  // whole. Embeddings and their ANN index rebuild once a healthy index loads.
  if (sweeping || off() || !vectorReady(db)) return 0
  sweeping = true
  let n = 0
  try {
    prune(db)
    for (let r of stale(db, limit)) {
      let vec = await embed(r.text)
      if (!vec) {
        // The box went unreachable mid-sweep — stop quietly (the rest stay
        // stale for the next sweep), but record the fault durably so a dark
        // embedder is an operator-visible fact, not silent (M-16612).
        if (health) {
          record(db, {
            source: 'srv',
            name: 'embed',
            ok: false,
            error: health.error,
            detail: `embed sweep stopped at ${n} fresh — ${MODEL} unreachable`,
          })
        }
        break
      }
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
  db: Sql,
  q: Float32Array,
  limit = 8,
  floor = 0,
) => {
  let live: { eid: string; score: number }[] = []
  for (let h of knn(db, q, limit + STALE_SLACK, MODEL)) {
    if (h.score < floor) break
    if (live.length == limit) break
    if (lives(db, h.eid)) live.push(h)
  }
  return live
}

// A doc's row is reusable only while it names this model and exact text.
// A stale sweep row must never answer for freshly edited prose.
export let stored = (
  db: Sql,
  eid: string,
  text: string,
): Float32Array | null => {
  let row = db.prepare(
    `select vec from embedding
     where entity = (select id from entity where eid = ?)
       and model = ? and hash = ?`,
  ).get(eid, MODEL, hash(text)) as { vec: Uint8Array } | undefined
  return row ? new Float32Array(row.vec.slice().buffer) : null
}

// The whole door: text in, neighbors out — null when there is no
// embedder to ask (the caller shows nothing, never an error). A doc can
// name its stored vector; arbitrary text still visits the embedder.
export let similarTo = async (
  db: Sql,
  text: string,
  limit = 8,
  floor = 0,
  eid?: string,
) => {
  let vec = eid ? stored(db, eid, text) : null
  vec ??= await embed(text)
  return vec ? similar(db, vec, limit, floor) : null
}

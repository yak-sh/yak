// The SQLite vector-search extension: select the prebuilt binary for this
// process, load it into a connection, and keep its persisted ANN data in step
// with the derived embedding table. SQLite triggers mark writes dirty; clearing
// that mark only after quantization makes an interrupted rebuild retry at boot.
//
// SERVER-ONLY, and importing this module must run NOTHING — no Deno API, no
// disk. It once detected the platform and `await import`ed the binary at top
// level; because embed.ts pulled this into the client bundle, that ran in the
// browser (where `Deno` is undefined) and crashed the canvas. The binary now
// resolves lazily inside loadVector, and twin.ts carries the pieces the client
// shares so nothing drags this loader across the wire (T-19451).

import type { Sql } from './store/sql.ts'
import type { DatabaseSync } from './store/sqlite.ts'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export let DIM = 384

// One prebuilt package per platform, keyed the way `Deno.build` spells it. The
// values are the deno.json import-map aliases — the one list of binaries — so
// import.meta.resolve turns each into a file path against the same map.
type Binary = { path: string }
let aliases: Record<string, string> = {
  'linux-x86_64': '@sqlite-vector-linux-x86_64',
  'linux-aarch64': '@sqlite-vector-linux-aarch64',
  'darwin-x86_64': '@sqlite-vector-darwin-x86_64',
  'darwin-aarch64': '@sqlite-vector-darwin-aarch64',
  'windows-x86_64': '@sqlite-vector-windows-x86_64',
}

// Resolve and load this platform's binary once, on first use. createRequire is
// synchronous — loadVector runs inside the synchronous open(), so the path must
// be in hand without awaiting a dynamic import.
let require = createRequire(import.meta.url)
let binary: Binary | undefined
let load = (): Binary => {
  if (binary) return binary
  let platform = `${Deno.build.os}-${Deno.build.arch}`
  let alias = aliases[platform]
  if (!alias) throw new Error(`SQLite Vector has no binary for ${platform}`)
  // require() hands back the CJS module.exports directly (`{ path }`); the
  // `.default` is only there under ESM interop. Accept either.
  let m = require(fileURLToPath(import.meta.resolve(alias)))
  return binary = (m.default ?? m) as Binary
}

// Vector search is a DERIVED, OPTIONAL feature — it rebuilds from the embed
// sweep — so it must never be a hard boot dependency of the whole server. A
// corrupt or incompatible persisted ANN index makes loadExtension THROW as it
// initializes against the bad data; catch it, disable vector search for this
// process, and let the server boot on FTS alone. `ready` gates every function
// below so none touches vector SQL against a connection that never loaded the
// extension.
//
// PER CONNECTION, not per process: the extension's functions belong to the
// handle they were loaded into, so a process holding mixed handles — one with
// the extension, one without — must not answer for both. It used to be a
// module-global boolean, which was merely lucky while connect() loaded the
// extension into every handle; the moment loading became opt-in (T-22622) that
// global started claiming vector SQL on plain handles and migrate() died with
// "no such function: vector_init".
let ready = new WeakSet<Sql>()
export let vectorReady = (db: Sql) => ready.has(db)

// WHO MAY QUANTIZE. `vector_quantize` is a native-extension WRITE, and it used
// to ride the READ path (knn → refreshVector), so any process that reached
// semantic search rebuilt the ANN index outside apply()'s serialization. The
// day dispatch split into its own daemon (T-22548) that made the write a
// SECOND writer's, from a connection that had never run vector_init — the
// 2026-08-26 split-brain (T-22622): the daemon that OWNED the sweep could not
// quantize ("Vector context not found") while the server quantized on its read
// path instead. So the write is claimed, once, by the process that runs the
// embed sweep (doing.ts) — D-22530's rule that a write-capable extension lives
// only where its write does. Everyone else reads: a dirty index degrades to
// staler neighbours, never a write.
let owns = false
export let ownVector = () => owns = true
export let vectorOwner = () => owns

// Loading is the file adapter's: loadExtension lives on its handle, not on Sql.
export let loadVector = (db: DatabaseSync) => {
  try {
    db.loadExtension(load().path)
    ready.add(db)
  } catch (e) {
    ready.delete(db)
    let why = e instanceof Error ? e.message : String(e)
    // Database-level corruption is NOT a vector problem: swallowing it here
    // hides the malformed-WAL signal connect()'s salvage listens for, and the
    // server would boot against a broken graph. Rethrow that class; only
    // vector-index trouble stays optional.
    if (why.includes('database disk image is malformed')) throw e
    console.error(
      `sqlite-vector: extension failed to load (corrupt/incompatible vector ` +
        `index?): ${why} — semantic search DISABLED, FTS still serves`,
    )
  }
}

let count = (db: Sql) =>
  (db.prepare('select count(*) n from embedding').get() as { n: number }).n

export let refreshVector = (db: Sql) => {
  if (!ready.has(db) || !owns) return 0
  let row = db.prepare('select dirty from embedding_index where id = 1')
    .get() as { dirty: number } | undefined
  if (!row?.dirty) return 0
  let n = count(db)
  if (n) {
    db.prepare(
      "select vector_quantize('embedding','vec','qtype=TURBO4')",
    ).get()
    db.prepare("select vector_quantize_preload('embedding','vec')").get()
  }
  db.prepare('update embedding_index set dirty = 0 where id = 1').run()
  return n
}

// K nearest stored vectors to a query, ranked by the persisted ANN index —
// the SQL that replaces embed.ts's hand-rolled cosine scan. `score` is cosine
// similarity (1 − the COSINE distance the extension reports), nearest first.
// STRICTLY READ-ONLY: this used to refreshVector() first, which made every
// caller of semantic search a native writer (T-22525). The sweep that owns the
// index quantizes it; a read that arrives while the index is dirty answers
// from the last quantization — staler neighbours, never a write. An empty
// corpus has no quantization table to scan, so it answers empty.
//
// `model`, when given, screens the scan to one embedding space. The ANN index
// holds every row regardless of model, so during a re-embed window (a model
// bump invalidates the whole corpus, which the async sweep replaces row by row)
// the old and new vectors are incomparable spaces — an unfiltered scan would
// rank across both and corrupt neighbours. The filter is applied AFTER the ANN
// scan, so a window where many scanned rows are the old space returns fewer than
// k; the caller over-fetches (embed.ts STALE_SLACK) and the window self-heals as
// the sweep completes (D-22781).
export let knn = (
  db: Sql,
  q: Float32Array,
  k: number,
  model?: string,
): { eid: string; score: number }[] => {
  if (!ready.has(db)) return []
  if (!count(db)) return []
  let bytes = new Uint8Array(q.buffer, q.byteOffset, q.byteLength)
  try {
    return (db.prepare(
      `select o.eid as eid, v.distance as distance
       from vector_quantize_scan('embedding', 'vec', ?, ?) v
       join embedding e on e.entity = v.id
       join entity o on o.id = e.entity
       ${model == null ? '' : 'where e.model = ?'}`,
    ).all(...(model == null ? [bytes, k] : [bytes, k, model])) as {
      eid: string
      distance: number
    }[])
      .map((r) => ({ eid: r.eid, score: 1 - r.distance }))
  } catch (e) {
    // Vectors exist but nothing has quantized them yet — a fresh graph, or one
    // rebuilt by `.recover` (which does not carry the extension's shadow
    // tables) before the sweep's first pass. Building it is the SWEEP's write,
    // never this read's, so answer empty until it lands. Every other failure is
    // a genuine fault and rides upward, where the effect dispatcher records it.
    let why = e instanceof Error ? e.message : String(e)
    if (!why.includes('Quantization table not found')) throw e
    return []
  }
}

// vector_init is BOTH halves of setup, and the second is the one that bites:
// it creates the persisted ANN table on a graph that lacks it (a write, hence
// migrate()), AND it establishes the extension's PER-CONNECTION context — the
// thing `vector_quantize` looks up. A connection that skipped it fails with
// "Vector context not found" no matter how healthy the file is. So every
// process that touches vector SQL calls this on ITS OWN handle; on a graph
// already initialized and not dirty it is byte-identical (measured), so another
// connection may call it freely.
export let initVector = (db: Sql) => {
  if (!ready.has(db)) return
  db.prepare(
    `select vector_init(
      'embedding', 'vec',
      'type=FLOAT32,dimension=${DIM},distance=COSINE'
    )`,
  ).get()
  let state = db.prepare('select id from embedding_index where id = 1').get()
  if (!state) {
    db.prepare('insert into embedding_index (id, dirty) values (1, 1)').run()
  }
  refreshVector(db)
}

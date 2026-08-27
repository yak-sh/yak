// similar()'s KNN path (T-18957): the vector extension's indexed ANN scan — the
// cost recall pays on every message, now that the JS cosine scan and its matrix
// cache are gone. A MICRO-bench over a fixed 800-vector corpus at the real 384
// dim: the ANN index quantizes on the first call (dirty), so the min metric the
// gate reads is the steady-state clean scan. A high floor keeps the ranked head
// tiny, so this measures the scan, not the lives() head-screen. The one-time
// quantize and embed() inference are the two costs it deliberately does NOT
// measure. `deno task bench`; gated by bin/bench-gate.ts.
Deno.env.set('DB_PATH', ':memory:')
let { MODEL, hash, similar } = await import('./embed.ts')
let { textBlob } = await import('./db.ts')
let { vectorDb } = await import('./testdb.ts')

let d = vectorDb()
let uid = (): string => crypto.randomUUID()
let DIM = 384
let N = 800
// A deterministic spread of unit vectors — index-seeded so the corpus is stable
// across runs and the min metric stays comparable.
let vecAt = (i: number) => {
  let xs = Array.from(
    { length: DIM },
    (_, k) => Math.sin(i * 0.017 + k * 0.031),
  )
  let n = Math.hypot(...xs)
  return Float32Array.from(xs.map((x) => x / n))
}
for (let i = 0; i < N; i++) {
  let e = uid()
  d.prepare('insert into entity (eid, num) values (?, ?)').run(e, 1_000_000 + i)
  d.prepare(
    `insert into doc (entity, title, body)
     values ((select id from entity where eid = ?), ?, ?)`,
  )
    .run(e, `Doc ${i}`, textBlob(d, ''))
  d.prepare('insert into embedding (eid, model, hash, vec) values (?, ?, ?, ?)')
    .run(e, MODEL, hash(`Doc ${i}`), new Uint8Array(vecAt(i).buffer))
}
let q = vecAt(N + 1) // an unstored query; the high floor keeps the head empty

Deno.bench('similar: ANN KNN over 800 vectors', () => {
  similar(d, q, 8, 0.9)
})

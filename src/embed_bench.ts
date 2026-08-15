// similar()'s cache-hit path (T-18121): the cosine dot over the model's vectors
// packed into one contiguous cache — the cost recall pays on every message. A
// MICRO-bench over a fixed 800-vector corpus at the real 384 dim, isolating the
// cache HIT: the matrix is built once on the first call, so the min metric the
// gate reads is steady-state. It guards the cache — a regression to the old
// per-row fetch + per-row Float32Array allocation runs ~5x this, far past the
// ratchet band. A high floor keeps the ranked head tiny, so this measures the
// matrix dot, not the lives() head-screen (a separate concern, and the
// O(relevant-subset) recall layer's to remove). The one-time build and embed()
// inference are the other two costs it deliberately does NOT measure.
// `deno task bench`; gated by bin/bench-gate.ts.
Deno.env.set('DB_PATH', ':memory:')
let { MODEL, hash, similar } = await import('./embed.ts')
let { freshDb } = await import('./testdb.ts')

let d = freshDb()
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
  d.prepare('insert into doc (eid, title, body) values (?, ?, ?)')
    .run(e, `Doc ${i}`, '')
  d.prepare('insert into embedding (eid, model, hash, vec) values (?, ?, ?, ?)')
    .run(e, MODEL, hash(`Doc ${i}`), new Uint8Array(vecAt(i).buffer))
}
let q = vecAt(N + 1) // an unstored query; the high floor keeps the head empty

Deno.bench('similar: cache-hit dot over 800 vectors', () => {
  similar(d, q, 8, 0.9)
})

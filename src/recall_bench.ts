// Auto-recall's selection path (T-17470): recallFrom runs on every message a
// session writes. A MICRO-bench over a small fixed corpus (36 tasks, 9 memories,
// 3 docs) that isolates v2's SELECTION logic — the ranked head, the batched
// rowsOf() over it, per-kind budget + floor + scope — as a regression guard, not
// model inference (the embedder never loads; precomputed vectors).
//
// The floor is rowsOf()'s: it fans out one indexed query per component table
// (~20) regardless of head size, so shrinking the corpus can't push it below
// that. Two costs it does NOT isolate, both separate concerns: similar()'s KNN
// (now the vector extension's ANN index, T-18957 — one quantize on the first
// call, then a clean scan) and embed()'s model inference. recall is a background
// post-commit effect dominated by embed(), so this is throughput, not user
// latency — the ratchet's job here is catching a selection-logic regression (a
// 2x is far past the band), not chasing sub-ms on shared hydration machinery.
// `deno task bench`; gated by bin/bench-gate.ts.
Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { MODEL, hash } = await import('./embed.ts')
let { vectorDb } = await import('./testdb.ts')
let { DIM } = await import('./vector.ts')
let { recallFrom } = await import('./recall.ts')

let d = vectorDb()
let uid = (): string => crypto.randomUUID()
// A deterministic spread of unit vectors — index-seeded so the graph is stable
// across runs and the min metric stays comparable.
let vecAt = (i: number) => {
  let xs = Array.from({ length: DIM }, (_, k) => Math.sin(i * 0.1 + k * 1.3))
  let n = Math.hypot(...xs)
  return Float32Array.from(xs.map((x) => x / n))
}
let put = (eid: string, text: string, v: Float32Array) =>
  d.prepare(
    `insert into embedding (entity, model, hash, vec)
     values ((select id from entity where eid = ?), ?, ?, ?)`,
  ).run(eid, MODEL, hash(text), new Uint8Array(v.buffer))

let p = uid()
apply(d, [{ eid: p, name: 'project', comp: {} }])
for (let i = 0; i < 36; i++) {
  let e = uid()
  apply(d, [
    { eid: e, name: 'doc', comp: { title: `Task ${i}`, body: '' } },
    { eid: e, name: 'task', comp: { project: p } },
  ])
  put(e, `Task ${i}`, vecAt(i))
}
for (let i = 0; i < 9; i++) {
  let e = uid()
  apply(d, [
    { eid: e, name: 'doc', comp: { title: `Memory ${i}`, body: '' } },
    { eid: e, name: 'memory', comp: {} },
  ])
  put(e, `Memory ${i}`, vecAt(i + 1000))
}
for (let i = 0; i < 3; i++) {
  let e = uid()
  apply(d, [{ eid: e, name: 'doc', comp: { title: `Doc ${i}`, body: '' } }])
  put(e, `Doc ${i}`, vecAt(i + 2000))
}

let q = vecAt(3)

Deno.bench('recallFrom: kind-aware selection over a small graph', () => {
  recallFrom(d, q, p)
})

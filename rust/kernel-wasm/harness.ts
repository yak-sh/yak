// The kernel-as-wasm proof harness (T-22559): loads the built module, feeds
// journal-shaped deltas, asks queries, and asserts the loop — then times it
// on a realistic cache. Run by hand (it is a proof, not a gate tier):
//
//   cargo build --release -p kernel-wasm --target wasm32-unknown-unknown
//   deno run --allow-read rust/kernel-wasm/harness.ts
//
// The JS here is the whole client contract: alloc, write utf-8, call,
// unpack (ptr << 32 | len), free — the SPA glue would be this file.

let wasmPath = new URL(
  '../target/wasm32-unknown-unknown/release/kernel_wasm.wasm',
  import.meta.url,
)
let bytes = await Deno.readFile(wasmPath)
let { instance } = await WebAssembly.instantiate(bytes, {})
let x = instance.exports as {
  memory: WebAssembly.Memory
  wasm_alloc: (len: number) => number
  wasm_free: (ptr: number, len: number) => void
  ingest: (ptr: number, len: number) => bigint
  query: (ptr: number, len: number) => bigint
  reset: () => void
  size: () => number
}

let enc = new TextEncoder()
let dec = new TextDecoder()

let call = <T>(s: string, f: (ptr: number, len: number) => T): T => {
  let b = enc.encode(s)
  let ptr = x.wasm_alloc(b.length)
  new Uint8Array(x.memory.buffer, ptr, b.length).set(b)
  let out = f(ptr, b.length)
  x.wasm_free(ptr, b.length)
  return out
}

let ingest = (changes: unknown[]): number =>
  Number(call(JSON.stringify(changes), (p, l) => x.ingest(p, l)))

let query = (line: string): { rows?: unknown[]; error?: string } => {
  let packed = call(line, (p, l) => x.query(p, l))
  let ptr = Number(packed >> 32n)
  let len = Number(packed & 0xffffffffn)
  let s = dec.decode(new Uint8Array(x.memory.buffer, ptr, len))
  x.wasm_free(ptr, len)
  return JSON.parse(s)
}

let eq = (name: string, got: unknown, want: unknown) => {
  let g = JSON.stringify(got)
  let w = JSON.stringify(want)
  if (g != w) throw new Error(`${name}: got ${g}, want ${w}`)
  console.log(`ok · ${name}`)
}

let uuid = (n: number) =>
  `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`

// ---- correctness: feed deltas, ask queries, see updates land ----

x.reset()
let P = uuid(90001)
ingest([
  { eid: P, name: 'entity', comp: { num: 9001 } },
  { eid: P, name: 'doc', comp: { title: 'Probe Project' } },
  { eid: P, name: 'project', comp: {} },
])
for (let i = 0; i < 4; i++) {
  let e = uuid(i)
  ingest([
    { eid: e, name: 'entity', comp: { num: 100 + i } },
    { eid: e, name: 'doc', comp: { title: `t${i}` } },
    {
      eid: e,
      name: 'task',
      comp: { status: i % 2 ? 'open' : 'done', priority: i, project: P },
    },
  ])
}

eq('size counts entities', x.size(), 5)
eq(
  'status filter',
  query('.status=open').rows!.map((r) => (r as { id: string }).id),
  ['T-101', 'T-103'],
)
eq(
  'ref value resolves through the cache (P-9001 -> eid)',
  query('.project=P-9001&.status=done').rows!.map((r) =>
    (r as { id: string }).id
  ),
  ['T-100', 'T-102'],
)
eq(
  'kind word lists projects',
  query('projects').rows!.map((r) => (r as { id: string }).id),
  ['P-9001'],
)
eq(
  'comparison ops ride (board order: open before done)',
  query('.priority>=2').rows!.map((r) => (r as { id: string }).id),
  ['T-103', 'T-102'],
)

// a delta flips one status — the same query answers differently
ingest([{ eid: uuid(0), name: 'task', comp: { status: 'open' } }])
eq(
  'delta updates change results',
  query('.status=open').rows!.map((r) => (r as { id: string }).id),
  ['T-100', 'T-101', 'T-103'],
)

// tombstone: the entity leaves every answer, late patches are void
ingest([{ eid: uuid(1), name: 'entity', comp: null }])
ingest([{ eid: uuid(1), name: 'task', comp: { status: 'open' } }])
eq(
  'tombstone removes and stays dead',
  query('.status=open').rows!.map((r) => (r as { id: string }).id),
  ['T-100', 'T-103'],
)

// unported grammar refuses loudly
let refused = query('.updated.at>=1-week-ago')
if (!refused.error) throw new Error('time phrase should refuse')
console.log(`ok · unported grammar refuses: ${refused.error}`)

// ---- timing: a realistic cache, then query overhead ----

x.reset()
let seed: unknown[] = []
let N = 3000
for (let i = 0; i < N; i++) {
  let e = uuid(1000 + i)
  seed.push(
    { eid: e, name: 'entity', comp: { num: 1000 + i } },
    { eid: e, name: 'doc', comp: { title: `task number ${i}` } },
    {
      eid: e,
      name: 'task',
      comp: {
        status: ['open', 'wip', 'done', 'cancelled'][i % 4],
        priority: i % 5,
        project: P,
      },
    },
    { eid: e, name: 'created', comp: { at: `2026-08-${(i % 28) + 1}` } },
  )
}
let t0 = performance.now()
ingest(seed)
let tIngest = performance.now() - t0
console.log(
  `ingest ${seed.length} changes (${N} entities): ${tIngest.toFixed(1)}ms`,
)

let lines = [
  '.status=open',
  '.status=open,wip&.priority<=2',
  '.priority>=3',
  'tasks',
]
for (let line of lines) {
  let k = 50
  let t = performance.now()
  let n = 0
  for (let i = 0; i < k; i++) n = query(line).rows!.length
  let per = (performance.now() - t) / k
  console.log(`query ${line}: ${per.toFixed(2)}ms/call, ${n} rows`)
}

let plain = bytes.length
let gz = (await new Response(
  new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
).arrayBuffer()).byteLength
console.log(`wasm size: ${plain} bytes plain, ${gz} gzipped`)
console.log('harness: all assertions passed')

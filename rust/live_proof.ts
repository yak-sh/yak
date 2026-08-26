// Live interop proof for the Rust write path (T-22550, T-22496 inverted):
// a Rust process writes the LIVE graph file directly — no HTTP, no WS — and
// a connected browser-shaped WS client must receive the frame through the
// server's own catchup feed; a stale `was` must refuse without a trace; the
// probe entity is then deleted through the same Rust door and the tombstone
// cast observed. Run by hand against a live server:
//
//   deno run -A rust/live_proof.ts [host]
//
// Writes exactly one probe entity to the live graph and tombstones it again.
let host = Deno.args[0] ?? '127.0.0.1:5173'
let bin = new URL('./target/release/task-rs', import.meta.url).pathname
let db = `${Deno.env.get('HOME')}/.tasks/tasks.db`

let up = await fetch(`http://${host}/providers`).then((r) => r.ok).catch(() =>
  false
)
if (!up) {
  console.error(`no live server at ${host} — refusing to run the live proof`)
  Deno.exit(2)
}

let eid = crypto.randomUUID()
let title = `rust write interop probe ${eid.slice(0, 8)}`

let frames: string[] = []
let ws = new WebSocket(`ws://${host}/ws`)
let opened = new Promise<void>((resolve, reject) => {
  ws.onopen = () => resolve()
  ws.onerror = (e) => reject(e)
})
ws.onmessage = (e) => frames.push(String(e.data))
await opened
ws.send(JSON.stringify({ since: 0, live: 1, ws: 1 }))

let saw = (needle: string) => frames.some((f) => f.includes(needle))
let until = async (cond: () => boolean, ms: number, what: string) => {
  let deadline = Date.now() + ms
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}
// the join reset lands first; note it, then only count frames AFTER it
await until(() => frames.length > 0, 10_000, 'the join answer')
frames.length = 0

let rust = async (batch: unknown) => {
  let t0 = performance.now()
  let out = await new Deno.Command(bin, {
    args: ['apply', '--db', db, '--batch', JSON.stringify(batch)],
  }).output()
  return {
    ok: out.success,
    ms: Math.round(performance.now() - t0),
    err: new TextDecoder().decode(out.stderr).trim(),
  }
}

// 1. mint through the Rust door
let w1 = await rust([{ eid, name: 'doc', comp: { title } }])
if (!w1.ok) throw new Error(`rust write refused: ${w1.err}`)
await until(() => saw(eid), 10_000, 'the live frame for the rust write')
console.log(`1. rust write → live WS frame OK (write ${w1.ms}ms)`)

// Under the delegator (T-22549) live follow-ons ride a client's OWN subs, so
// subscribe to the probe entity the way a fullscreen view would before
// expecting its patches.
ws.send(JSON.stringify({ sub: `route:${eid}`, q: `id=${eid}` }))
await new Promise((r) => setTimeout(r, 300))

// 2. a stale was refuses, and no frame follows
frames.length = 0
import { sha } from '../src/sha.ts'
let w2 = await rust([{
  eid,
  name: 'doc',
  comp: { title: 'clobbered' },
  was: { title: sha('not what is stored') },
}])
if (w2.ok) throw new Error('stale was was ACCEPTED — precondition broken')
await new Promise((r) => setTimeout(r, 500))
if (saw(eid)) throw new Error('a refused batch still cast a frame')
console.log(`2. stale was refused, nothing cast OK — ${w2.err.split('\n')[0]}`)

// 3. a good was passes
let w3 = await rust([{
  eid,
  name: 'doc',
  comp: { title: `${title} v2` },
  was: { title: sha(title) },
}])
if (!w3.ok) throw new Error(`guarded patch refused: ${w3.err}`)
await until(() => saw(`${title} v2`), 10_000, 'the patched frame')
console.log(`3. guarded patch → live frame OK (${w3.ms}ms)`)

// 4. delete through the Rust door; the tombstone cast arrives
frames.length = 0
let w4 = await rust([{ eid, name: 'entity', comp: null }])
if (!w4.ok) throw new Error(`rust delete refused: ${w4.err}`)
await until(() => saw(eid), 10_000, 'the tombstone cast')
console.log(`4. rust delete → tombstone cast OK (${w4.ms}ms)`)

ws.close()
console.log('LIVE INTEROP OK — rust wrote the live file; the TS feed cast it')

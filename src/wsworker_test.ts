// The delegator split (T-22549, D-22388 step 4), proven on a FILE-backed
// graph — the mode where every WS connection is served by its own worker.
// Two layers: the worker module driven directly (init → raw frames in, frames
// out, writes posted back), and the booted server end to end (join, sub,
// acked write, refusal — the client-facing frame semantics that must not have
// moved in the split). All slow(): a server boot and worker spawns have no
// place in the 1ms tier.
import { assert, assertEquals } from '@std/assert'
import { slow } from './testing.ts'

let dir = await Deno.makeTempDir({ prefix: 'wsworker-test-' })
Deno.env.set('DB_PATH', `${dir}/graph.db`)
// The delegator's worker mode is opt-in (default inline since the 2026-08-26
// corruption); these tests exist to exercise the worker path, so opt in.
Deno.env.set('TASKS_WS_WORKERS', '1')
let alone = { sanitizeOps: false, sanitizeResources: false }

let U = ''
if (Deno.env.get('TASKS_SLOW')) {
  let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (seat.addr as Deno.NetAddr).port
  seat.close()
  Deno.env.set('PORT', String(port))
  await import('./server.ts')
  U = `127.0.0.1:${port}`
}

let uid = () => crypto.randomUUID()

// One socket wrapped as an awaitable frame queue: every arriving frame lands
// in order, and next() hands them out one at a time (pings skipped — the
// heartbeat is traffic, not an answer).
let dial = async (path = '/ws') => {
  let sock = new WebSocket(`ws://${U}${path}`)
  let queue: unknown[] = []
  let waiters: ((f: unknown) => void)[] = []
  sock.onmessage = (m) => {
    let f = JSON.parse(String(m.data))
    if (f && typeof f == 'object' && 'ping' in f) return
    let w = waiters.shift()
    w ? w(f) : queue.push(f)
  }
  await new Promise((ok, no) => {
    sock.onopen = ok
    sock.onerror = no
  })
  let next = (ms = 30000) =>
    queue.length ? Promise.resolve(queue.shift()!) : new Promise((ok, no) => {
      let t = setTimeout(() => no(new Error('no frame within deadline')), ms)
      waiters.push((f) => {
        clearTimeout(t)
        ok(f)
      })
    })
  return { sock, next }
}

slow(
  'wsworker: the worker module serves join and subs, posts writes back',
  alone,
  async () => {
    let w = new Worker(new URL('./wsworker.ts', import.meta.url), {
      type: 'module',
    })
    w.onerror = (e) => {
      throw new Error(`worker failed: ${e.message}`)
    }
    let queue: unknown[] = []
    let waiters: ((m: unknown) => void)[] = []
    w.onmessage = (m) => {
      let waiter = waiters.shift()
      waiter ? waiter(m.data) : queue.push(m.data)
    }
    let next = (ms = 30000) =>
      queue.length ? Promise.resolve(queue.shift()!) : new Promise((ok, no) => {
        let t = setTimeout(() => no(new Error('worker: no message')), ms)
        waiters.push((f) => {
          clearTimeout(t)
          ok(f)
        })
      })
    w.postMessage({ init: Deno.env.get('DB_PATH') })
    // Join: since:0 against a fresh epoch resets with the working set.
    w.postMessage({ raw: JSON.stringify({ since: 0, live: 1, ws: 1 }) })
    let joined = await next() as { frame: string }
    let reset = JSON.parse(joined.frame)
    assert(reset.reset === true && reset.snapshot, 'join answers a reset')
    // A sub: empty result set is fine — the frame shape is what's under test.
    w.postMessage({ raw: JSON.stringify({ sub: 'q:probe', q: '.task!' }) })
    let subbed = JSON.parse(((await next()) as { frame: string }).frame)
    assertEquals(subbed.sub, 'q:probe')
    assert(subbed.replace === true && Array.isArray(subbed.changes))
    // A write batch never applies here — it posts back to the writer process.
    let eid = uid()
    let batch = [{ eid, name: 'doc', comp: { title: 'from worker test' } }]
    w.postMessage({ raw: JSON.stringify({ apply: batch, id: 'd1' }) })
    let write = await next() as { apply: unknown[]; id?: string }
    assertEquals(write.id, 'd1')
    assertEquals(write.apply, batch)
    // A cast folds into the standing sub. Commit a task through the server
    // first (the worker's read-only connection sees the same file), then hand
    // the worker the committed batch: the sub frame carries the add.
    let task = uid()
    let committed = [
      { eid: task, name: 'doc', comp: { title: 'cast fold' } },
      { eid: task, name: 'task', comp: { status: 'open' } },
    ]
    let posted = await fetch(`http://${U}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(committed),
    })
    assert(posted.ok)
    await posted.body?.cancel()
    w.postMessage({ cast: committed, cursor: 99 })
    let folded = JSON.parse(((await next()) as { frame: string }).frame)
    assertEquals(folded.sub, 'q:probe')
    assert(
      (folded.changes as { eid: string }[]).some((c) => c.eid == task),
      'the committed task folds into the sub',
    )
    assertEquals(folded.cursor, 99)
    w.terminate()
  },
)

slow(
  'delegator end to end: join, sub, acked write, refusal — one socket, one worker',
  alone,
  async () => {
    let { sock, next } = await dial()
    sock.send(JSON.stringify({ since: 0, live: 1, ws: 1 }))
    let reset = await next() as { reset?: boolean; snapshot?: unknown }
    assert(reset.reset === true, 'cold join resets')
    // Subscribe to open tasks, then create one over the SAME socket with an
    // acked write: the ack and the sub's add frame both arrive.
    sock.send(JSON.stringify({ sub: 'q:e2e', q: '.task.status=open' }))
    let replace = await next() as { sub?: string; replace?: boolean }
    assertEquals(replace.sub, 'q:e2e')
    let eid = uid()
    sock.send(JSON.stringify({
      apply: [
        { eid, name: 'doc', comp: { title: 'delegator e2e' } },
        { eid, name: 'task', comp: { status: 'open' } },
      ],
      id: 'w1',
    }))
    let seen = { ack: false, add: false }
    for (let i = 0; i < 4 && !(seen.ack && seen.add); i++) {
      let f = await next() as {
        ack?: string
        sub?: string
        changes?: { eid: string }[]
      }
      if (f.ack == 'w1') seen.ack = true
      if (f.sub == 'q:e2e' && f.changes?.some((c) => c.eid == eid)) {
        seen.add = true
      }
    }
    assert(seen.ack, 'the write acked')
    assert(seen.add, 'the sub folded the commit in')
    // A refusing batch answers the error frame with the scoped correction.
    sock.send(JSON.stringify({
      apply: [{ eid, name: 'doc', comp: { title: 'x' }, was: { title: 'y' } }],
      id: 'w2',
    }))
    let err = await next() as { error?: string; id?: string }
    assert(err.error, 'a guarded write that moved refuses')
    assertEquals(err.id, 'w2')
    sock.close()
  },
)

slow(
  "two sockets: a commit through one reaches the other worker's sub",
  alone,
  async () => {
    let a = await dial()
    let b = await dial()
    b.sock.send(JSON.stringify({ sub: 'q:other', q: '.task.status=open' }))
    await b.next()
    let eid = uid()
    a.sock.send(JSON.stringify({
      apply: [
        { eid, name: 'doc', comp: { title: 'cross-worker' } },
        { eid, name: 'task', comp: { status: 'open' } },
      ],
      id: 'x1',
    }))
    let f = await b.next() as { sub?: string; changes?: { eid: string }[] }
    assertEquals(f.sub, 'q:other')
    assert(f.changes?.some((c) => c.eid == eid), 'the other socket heard it')
    a.sock.close()
    b.sock.close()
  },
)

/// <reference lib="deno.ns" />
// The pool: a commit writes down what it owes, whoever wrote it, and any
// number of processes over the same storage claim those runs and run each
// once. Two processes here are two graphs over one store.

import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, graph, type Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { until } from '../../bin/testing.ts'
import { effects, type Handler, type Opts } from './registry.ts'
import { pooledBlog } from './testing.ts'

let store = () => ram(pooledBlog, { number: true })

// A process over `storage`: its graph, its registry, and what its effects did.
let proc = (storage: Storage, opts: Partial<Opts> = {}) => {
  let ran: string[] = []
  let oops: unknown[] = []
  let fx = effects(pooledBlog, {
    write: (b) => g.apply(b, { trusted: true }),
    report: (e) => void oops.push(e),
    ...opts,
  })
  let g = graph({ storage, vocab: pooledBlog, plugins: [fx] })
  let note: Handler = (e) => void ran.push(`${e.kind} ${e.entity.eid}`)
  return { g, fx, ran, oops, note }
}

let post = (eid: string, comp: Comp = { title: 'One' }) => ({
  entity: { eid },
  post: comp,
})

type Reads = { read: (q: string) => Bundle[] | Promise<Bundle[]> }

let rows = async (g: Reads, q = '.effect') =>
  (await g.read(q)).map((b) => b[q.slice(1)] as Comp)

// The runs written down, as `handler target state`, in a stable order.
let owed = async (g: Reads) =>
  (await rows(g)).map((e) => `${e.handler} ${e.target} ${e.state}`).sort()

// The first run written down for `handler` and `target`.
let run = async (g: Reads, handler: string, target = 'p1') =>
  (await rows(g)).find((e) => e.handler == handler && e.target == target)!

Deno.test('a commit writes down what it owes, and a writer working nothing runs none', async () => {
  let a = proc(store())
  a.fx.handle({ post_note: a.note })
  await a.g.apply([post('p1')])
  await a.fx.idle()
  assertEquals(a.ran, [])
  assertEquals(await owed(a.g), [
    'post_note p1 pending',
    'post_swept p1 pending',
  ])
})

Deno.test('a batch that never commits owes nothing', async () => {
  let a = proc(store())
  await a.g.apply([post('p1')], { check: true })
  assertEquals(await owed(a.g), [])
})

Deno.test('a process working the pool runs what it writes, once committed', async () => {
  let a = proc(store())
  a.fx.handle({ post_note: a.note })
  await a.fx.work(a.g)
  await a.g.apply([post('p1')])
  await a.g.apply([post('p1', { published: true })])
  await a.g.apply([post('p1', { title: 'Two' })])
  await a.fx.idle()
  assertEquals(a.ran, ['created p1', 'changed p1'])
  assertEquals((await owed(a.g)).filter((r) => r.startsWith('post_note')), [
    'post_note p1 done',
    'post_note p1 done',
  ])
})

Deno.test('what one process wrote, another runs, and only one of many', async () => {
  let s = store()
  let [w, a, b] = [proc(s), proc(s), proc(s)]
  let ran: string[] = []
  for (let p of [a, b]) {
    p.fx.handle({ post_note: (e) => void ran.push(e.entity.eid) })
  }
  await w.g.apply([post('p1')])
  await Promise.all([a.fx.work(a.g), b.fx.work(b.g)])
  await Promise.all([a.fx.idle(), b.fx.idle()])
  assertEquals(ran, ['p1'])
  assertEquals((await run(w.g, 'post_note')).state, 'done')
})

Deno.test('a run that throws comes back due, and rests failed once its tries are spent', async () => {
  let t = 0
  let a = proc(store(), { now: () => t })
  let tries = 0
  a.fx.handle({
    post_note: () => {
      tries++
      throw new Error('no')
    },
  })
  await a.fx.work(a.g)
  await a.g.apply([post('p1')])
  await a.fx.idle()
  assertEquals((await run(a.g, 'post_note')).state, 'pending')
  assertEquals((await run(a.g, 'post_note')).error, 'no')
  // Waiting out its backoff: nothing runs early.
  t = 500
  await a.fx.work(a.g)
  assertEquals(tries, 1)
  t = 1_000
  await a.fx.work(a.g)
  assertEquals(tries, 2)
  // `post_note` declares two tries.
  assertEquals((await run(a.g, 'post_note')).state, 'failed')
  assertEquals((await run(a.g, 'post_note')).error, 'no')
  assertEquals(a.oops.length, 2)
})

Deno.test('a run its worker dropped is run again, unless running twice is not safe', async () => {
  let s = store()
  // A worker that claims both runs as it writes them, and dies in both.
  let dead = proc(s, { lease: 10, now: () => 0 })
  let hang = () => new Promise(() => {})
  dead.fx.handle({ post_note: hang, post_gone: hang })
  await dead.fx.work(dead.g)
  await dead.g.apply([post('p1')])
  await dead.g.apply([{ entity: { eid: 'p1' }, post: null }])
  let next = proc(s, { now: () => 1_000 })
  next.fx.handle({ post_note: next.note, post_gone: next.note })
  await next.fx.work(next.g)
  await next.fx.idle()
  assertEquals(next.ran, ['created p1'])
  assertEquals((await run(next.g, 'post_note')).state, 'done')
  assertEquals((await run(next.g, 'post_gone')).state, 'failed')
})

Deno.test('a sweep owes what it selects one run, however many workers start at once', async () => {
  let s = store()
  // Written by a graph that owes nothing: no registry at all.
  let bare = graph({ storage: s, vocab: pooledBlog })
  await bare.apply([post('p1'), post('p2')])
  let [a, b] = [proc(s), proc(s)]
  let ran: string[] = []
  for (let p of [a, b]) {
    p.fx.handle({ post_swept: (e) => void ran.push(e.entity.eid) })
  }
  await Promise.all([a.fx.work(a.g), b.fx.work(b.g)])
  await Promise.all([a.fx.idle(), b.fx.idle()])
  assertEquals(ran.sort(), ['p1', 'p2'])
  // A second pass is not a worker coming up.
  await a.fx.work(a.g)
  assertEquals(ran.length, 2)
  // The next one to come up sweeps again: a sweep is how what nobody wrote
  // down is found, so what it selects is owed until it stops selecting it.
  let c = proc(s)
  c.fx.handle({ post_swept: (e) => void ran.push(e.entity.eid) })
  await c.fx.work(c.g)
  await c.fx.idle()
  assertEquals(ran.length, 4)
})

// Code for every effect the blog declares, so a worker can serve the pool.
let every = (note: Handler) => ({
  post_note: note,
  post_gone: note,
  post_swept: () => {},
})

Deno.test('a pass on the way through leaves the pool to a process that stays', async () => {
  let s = store()
  let server = proc(s, { owner: 'server' })
  let cli = proc(s, { owner: 'cli' })
  server.fx.handle(every(server.note))
  cli.fx.handle(every(cli.note))
  await cli.g.apply([post('p1')])
  let up = new AbortController()
  let serving = server.fx.work(server.g, up.signal)
  await until(() => server.ran.length)
  await cli.g.apply([post('p2')])
  await cli.fx.work(cli.g)
  assertEquals(cli.ran, [])
  assertEquals(server.ran, ['created p1'])
  assertEquals((await run(cli.g, 'post_note', 'p2')).state, 'pending')
  up.abort()
  await serving
  // Its presence goes with it, and the next pass through works the pool.
  assertEquals(await rows(cli.g, '.lease'), [])
  await cli.fx.work(cli.g)
  await cli.fx.idle()
  assertEquals(cli.ran, ['created p2'])
})

Deno.test('a process working only some effects leaves the rest to a pass through', async () => {
  let s = store()
  let some = proc(s, { owner: 'some' })
  let cli = proc(s, { owner: 'cli' })
  some.fx.handle({ post_gone: some.note })
  cli.fx.handle(every(cli.note))
  await cli.g.apply([post('p0')])
  await cli.g.apply([{ entity: { eid: 'p0' }, $delete: true }])
  let up = new AbortController()
  let serving = some.fx.work(some.g, up.signal)
  // It has been through a pass, so it would be present by now if it were.
  await until(() => some.ran.length)
  await cli.g.apply([post('p1')])
  await cli.fx.work(cli.g)
  await cli.fx.idle()
  assert(cli.ran.includes('created p1'), cli.ran.join())
  up.abort()
  await serving
})

Deno.test('a thread that wrote runs down wakes the worker beside it', async () => {
  let s = store()
  let server = proc(s, { owner: 'server' })
  server.fx.handle(every(server.note))
  let up = new AbortController()
  let serving = server.fx.work(server.g, up.signal)
  await until(async () => (await rows(server.g, '.lease')).length)
  let beside = proc(s, { nudge: () => server.fx.wake() })
  await beside.g.apply([post('p1')])
  // Well inside the pass the worker would otherwise wait for.
  await until(() => server.ran.length, { timeout: 500 })
  assertEquals(server.ran, ['created p1'])
  up.abort()
  await serving
})

Deno.test('a process that stops leaves what it writes next for the others', async () => {
  let a = proc(store())
  a.fx.handle({ post_note: a.note })
  await a.fx.work(a.g)
  await a.fx.stop()
  await a.g.apply([post('p1')])
  await a.fx.idle()
  assertEquals(a.ran, [])
  assert(!(await run(a.g, 'post_note')).lease_owner)
})

Deno.test("a run's write owes a generation on, and the chain stops at depth", async () => {
  let a = proc(store())
  a.fx.handle({
    post_note: async (e, _tx, write) => {
      await write([post(`${e.entity.eid}+`)])
      a.ran.push(e.entity.eid)
    },
  })
  await a.fx.work(a.g)
  await a.g.apply([post('p')])
  await a.fx.idle()
  // The client's post owes a run, and so does the post that run wrote; the
  // post that one wrote is past the depth and owes nothing.
  assertEquals(a.ran.sort(), ['p', 'p+'])
  assertEquals((await rows(a.g, '.post')).length, 3)
})

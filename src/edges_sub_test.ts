// The server half of the EDGES rider (T-22371, D-22567 §2): a row sub carrying
// `.edges!` is delivered the dep triples INCIDENT to its members, and with
// `.edges.peers=` the far endpoint's named columns beside them — so a
// requires-tree renders without a subscription per blocker.
//
// This is the door that replaced `allDeps`: the join snapshot used to hand every
// joining client every edge between two eager entities (4,909 triples, 557 KB,
// 81% of the frame, measured on the live board) because an edge had no scoped
// delivery at all. So the frames matter as much as the
// membership: the initial one must carry this sub's edges and only those, and
// every later batch must arrive as a DELTA — a link, an unlink, a peer's own
// edit, a peer's death. Driven against the REAL /ws door on a booted server;
// the client half (refcounting, eviction) is proven in live_test.ts over
// landSub().

import { assert, assertEquals } from '@std/assert'
import { link, typeOf, unlink } from './edge.ts'
import { slow } from './testing.ts'
import type { Change, Dep } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')

// Boot only under the heavy tier — the fast run must not pay the server boot
// (the same seat-claim agg_sub_test.ts uses; a fixed port collides).
let U = ''
if (Deno.env.get('TASKS_SLOW')) {
  Deno.env.set('PORT', '0')
  let { http } = await import('./server.ts')
  let port = (http.addr as Deno.NetAddr).port
  U = `127.0.0.1:${port}`
}
let alone = { sanitizeOps: false, sanitizeResources: false }
let uid = () => crypto.randomUUID()

type Frame = {
  sub?: string
  changes?: Change[]
  drop?: string[]
  replace?: boolean
  edges?: Dep[]
  unedges?: Dep[]
  peers?: Change[]
  unpeers?: string[]
}

let post = async (changes: unknown[]) => {
  let res = await fetch(`http://${U}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(changes),
  })
  await res.text()
  return res.status
}

// One socket, one route sub — the exact shape live.ts routeSub sends, `id=`
// address and rider together. Frames for this sub queue in order and each await
// pops the next, so an apply's delta is awaited, never slept for.
let dial = async (name: string, q: string) => {
  let sock = new WebSocket(`ws://${U}/ws`)
  let queue: Frame[] = []
  let waiters: ((f: Frame) => void)[] = []
  sock.onmessage = (m) => {
    let f = JSON.parse(String(m.data)) as Frame
    if (f.sub != name) return
    let w = waiters.shift()
    w ? w(f) : queue.push(f)
  }
  await new Promise((r) => sock.onopen = r)
  sock.send(JSON.stringify({ sub: name, q, shadow: true }))
  let next = () =>
    queue.length
      ? Promise.resolve(queue.shift()!)
      : new Promise<Frame>((r) => waiters.push(r))
  return { sock, next }
}

let task = (eid: string, title: string, body = 'the whole body') => [
  { eid, name: 'doc', comp: { title, body } },
  { eid, name: 'task', comp: { priority: 1 } },
]

// One peer's projected columns, keyed by component — what the client lands.
let peerOf = (f: Frame, eid: string) => {
  let out: Record<string, Record<string, unknown>> = {}
  for (let c of f.peers ?? []) {
    if (c.eid != eid || !c.comp) continue
    out[c.name] = { ...out[c.name], ...c.comp }
  }
  return out
}

let holds = (edges: Dep[] | undefined, parent: string, child: string) =>
  (edges ?? []).some((d) =>
    d.parent == parent && d.child == child && d.type == 'requires'
  )

slow('an edges rider answers scoped, then speaks deltas', alone, async () => {
  let a = uid(), b = uid(), c = uid(), far = uid(), other = uid()
  assertEquals(await post(task(a, 'the tree')), 200)
  assertEquals(await post(task(b, 'first blocker')), 200)
  assertEquals(await post(task(c, 'second blocker')), 200)
  // An edge that touches NEITHER endpoint of the sub — the one a whole-graph
  // dump would have shipped anyway, and the whole point of scoping.
  assertEquals(await post(task(far, 'unrelated')), 200)
  assertEquals(await post(task(other, 'also unrelated')), 200)
  assertEquals(
    await post([
      ...link(a, 'requires', b),
      ...link(far, 'requires', other),
    ]),
    200,
  )

  let name = `route:${a}`
  let { sock, next } = await dial(
    name,
    `id=${a}&.edges.peers=task.status,doc.title`,
  )

  // The initial frame: this sub's own edge, and NOT the graph's.
  let first = await next()
  assertEquals(first.replace, true)
  assertEquals(holds(first.edges, a, b), true, 'the incident edge rides')
  assertEquals(
    holds(first.edges, far, other),
    false,
    'an edge between two strangers does not',
  )
  assertEquals(first.edges?.length, 1, 'scoped means scoped')

  // The far endpoint arrives PROJECTED: nameable (spine + kind), the two named
  // columns, and no body — a peer is a read of two columns, not a subscription.
  let peer = peerOf(first, b)
  assertEquals(peer.doc?.title, 'first blocker')
  assertEquals(peer.task?.status, 'open')
  assertEquals('body' in (peer.doc ?? {}), false, 'a peer carries no body')
  assert(peer.entity, 'a peer carries its spine, so the tree can name it')

  // A PEER's own edit reaches the tree: nothing about membership moved, and no
  // sub holds b, so only the rider could have noticed.
  assertEquals(
    await post([{ eid: b, name: 'completed', comp: {} }]),
    200,
  )
  assertEquals(peerOf(await next(), b).task?.status, 'done')

  // A new edge arrives as a delta, with its new peer beside it.
  assertEquals(
    await post([
      ...link(a, 'requires', c),
    ]),
    200,
  )
  let added = await next()
  assertEquals(holds(added.edges, a, c), true)
  assertEquals(added.unedges ?? [], [])
  assertEquals(peerOf(added, c).doc?.title, 'second blocker')

  // Unlinking says the same sentence with gone — the triple leaves, and so does
  // the peer nothing points at any more.
  assertEquals(
    await post([
      ...unlink(a, 'requires', b),
    ]),
    200,
  )
  let cut = await next()
  assertEquals(holds(cut.unedges, a, b), true)
  assertEquals(cut.unpeers, [b])

  // A peer's DEATH takes its edge with it: apply() reaps the sentence's own
  // entity through edge.from/to, so the rider has to answer for it.
  assertEquals(await post([{ eid: c, name: 'entity', comp: null }]), 200)
  let dead = await next()
  assertEquals(holds(dead.unedges, a, c), true)
  assertEquals(dead.unpeers, [c])

  sock.close()
  await new Promise((r) => sock.onclose = r)
})

slow(
  'the rider screens the lazy partition, as the graph-out door does',
  alone,
  async () => {
    // A session-log ENTRY is never in a client's cache — the root snapshot omits
    // the partition on purpose. So an entry's edge is a triple whose far endpoint
    // no cache will ever hold, and delivering it would put a dangling edge in the
    // client's table. `allDeps` screened these out; the rider has to agree, or the
    // wire says two different things about what an edge is. It is a real volume
    // question too: on the live graph one well-referenced task carries 522
    // incident edges, 469 of them from entries.
    let a = uid(), sess = uid(), log = uid(), plain = uid()
    assertEquals(await post(task(a, 'the referenced one')), 200)
    assertEquals(await post(task(plain, 'an eager referrer')), 200)
    assertEquals(
      await post([{ eid: sess, name: 'session', comp: { id: `s-${sess}` } }]),
      200,
    )
    assertEquals(
      await post([
        { eid: log, name: 'entry', comp: { session: sess, seq: 1 } },
        { eid: log, name: 'content', comp: { body: 'mentions it' } },
      ]),
      200,
    )
    assertEquals(
      await post([
        ...link(log, 'referenced', a),
        ...link(plain, 'referenced', a),
      ]),
      200,
    )

    let name = `route:${a}`
    let { sock, next } = await dial(name, `id=${a}&.edges.peers=doc.title`)
    let first = await next()
    assertEquals(
      (first.edges ?? []).map((d) => d.parent),
      [plain],
      'the eager referrer rides; the entry does not',
    )
    assertEquals(
      (first.peers ?? []).some((c) => c.eid == log),
      false,
      'and no peer row for an entity the cache could never hold',
    )

    // The same screen on the DELTA arm: a fresh entry edge is not news either.
    let log2 = uid()
    assertEquals(
      await post([
        { eid: log2, name: 'entry', comp: { session: sess, seq: 2 } },
        { eid: log2, name: 'content', comp: { body: 'again' } },
      ]),
      200,
    )
    assertEquals(
      await post([
        ...link(log2, 'referenced', a),
        { eid: a, name: 'doc', comp: { title: 'renamed to force a frame' } },
      ]),
      200,
    )
    let f = await next()
    assertEquals(f.edges ?? [], [], 'a lazy edge is not delivered as a delta')

    sock.close()
    await new Promise((r) => sock.onclose = r)
  },
)

slow(
  'a typed rider projects entry endpoints to their session without loading entries',
  alone,
  async () => {
    let target = uid(), session = uid(), one = uid(), two = uid()
    assertEquals(await post(task(target, 'citation target')), 200)
    assertEquals(
      await post([
        { eid: session, name: 'session', comp: { id: `s-${session}` } },
        { eid: one, name: 'entry', comp: { session, seq: 1 } },
        { eid: two, name: 'entry', comp: { session, seq: 2 } },
        ...link(one, 'referenced', target),
        ...link(two, 'referenced', target),
      ]),
      200,
    )

    let rider = '.edges[referenced,entry.session]!&.edges.peers=doc.title'
    let { sock, next } = await dial(
      `citations:${session}`,
      `id=${session}&${rider}`,
    )
    let first = await next()
    assertEquals(first.edges, [
      { parent: session, type: 'referenced', child: target },
    ])
    assertEquals(peerOf(first, target).doc?.title, 'citation target')
    assertEquals(
      (first.changes ?? []).some((c) => c.eid == one || c.eid == two),
      false,
      'the entry partition never rides the result',
    )

    // Two stored sentences collapse to one projected sentence. Removing one
    // keeps it; the target edit forces a frame so the empty edge diff is proven.
    assertEquals(
      await post([
        ...unlink(one, 'referenced', target),
        { eid: target, name: 'doc', comp: { title: 'still cited' } },
      ]),
      200,
    )
    let kept = await next()
    assertEquals(kept.edges ?? [], [])
    assertEquals(kept.unedges ?? [], [])
    assertEquals(peerOf(kept, target).doc?.title, 'still cited')

    assertEquals(
      await post([
        ...unlink(two, 'referenced', target),
      ]),
      200,
    )
    let cut = await next()
    assertEquals(cut.unedges, [
      { parent: session, type: 'referenced', child: target },
    ])
    assertEquals(cut.unpeers, [target])

    sock.close()
    await new Promise((r) => sock.onclose = r)
  },
)

slow('a sub that never asks is delivered no edges at all', alone, async () => {
  let a = uid(), b = uid()
  assertEquals(await post(task(a, 'plain parent')), 200)
  assertEquals(await post(task(b, 'plain child')), 200)
  assertEquals(
    await post([
      ...link(a, 'requires', b),
    ]),
    200,
  )

  let name = `route:${a}`
  let { sock, next } = await dial(name, `id=${a}`)
  let first = await next()
  assertEquals(first.replace, true)
  assertEquals(first.edges, undefined, 'no rider, no edges')
  assertEquals(first.peers, undefined)

  // And a LATER link does not leak in through the row payload either — an edge
  // landing in a client's table with no sub holding it could never be evicted,
  // which is the state the rider exists to end (subs.ts `unedged`).
  assertEquals(
    await post([
      { eid: a, name: 'doc', comp: { title: 'renamed' } },
      ...link(a, 'requires', b),
    ]),
    200,
  )
  let f = await next()
  assertEquals(f.edges, undefined)
  assertEquals(
    (f.changes ?? []).some((c) => c.name == 'edge' || typeOf[c.name]),
    false,
    'an edge entity never rides a row payload',
  )

  sock.close()
  await new Promise((r) => sock.onclose = r)
})

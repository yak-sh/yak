// The server half of the aggregate subscription (T-21283): a query carrying
// `.tally=comp.prop` subscribes to a VALUE→COUNT map instead of a member
// list — one sub serves every tile's comment badge, so per-row reverse-lookups
// never open per-entity subs. These drive the REAL /ws door against a booted
// server: the initial frame must carry the whole tally, and later applied
// batches must arrive as deltas — a comment's birth, retargeting (one frame
// moving both keys), and death (n=0 drops the key). The client half of the
// same wire is proven in live_test.ts over landSub().

import { assertEquals } from '@std/assert'
import { slow } from './testing.ts'

Deno.env.set('DB_PATH', ':memory:')

// Boot only under the heavy tier — the fast run must not pay the server boot
// (the same seat-claim precondition_test.ts uses; a fixed port collides).
let U = ''
if (Deno.env.get('TASKS_SLOW')) {
  let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (seat.addr as Deno.NetAddr).port
  seat.close()
  Deno.env.set('PORT', String(port))
  await import('./server.ts')
  U = `127.0.0.1:${port}`
}
let alone = { sanitizeOps: false, sanitizeResources: false }
let uid = () => crypto.randomUUID()

type AggFrame = {
  sub?: string
  agg?: Record<string, number>
  changes?: unknown[]
  replace?: boolean
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

// One socket, one agg sub; frames matching the sub queue in order and each
// await pops the next — an apply's delta is awaited, never slept for.
let dial = async (q: string, name = 'agg:t') => {
  let sock = new WebSocket(`ws://${U}/ws`)
  let queue: AggFrame[] = []
  let waiters: ((f: AggFrame) => void)[] = []
  sock.onmessage = (m) => {
    let f = JSON.parse(String(m.data)) as AggFrame
    if (f.sub != name) return
    // An aggregate sub answers a VALUE. No row ever rides its frames — that is
    // the whole of T-22509, so assert it on every frame rather than once.
    assertEquals(f.changes, undefined)
    let w = waiters.shift()
    w ? w(f) : queue.push(f)
  }
  await new Promise((r) => sock.onopen = r)
  sock.send(JSON.stringify({ sub: name, q, shadow: true }))
  let next = () =>
    queue.length
      ? Promise.resolve(queue.shift()!)
      : new Promise<AggFrame>((r) => waiters.push(r))
  return { sock, next }
}

let comment = (eid: string, target: string) => [
  { eid, name: 'doc', comp: { title: '', body: 'hi' } },
  { eid, name: 'comment', comp: { target } },
]

slow('an aggregate sub answers whole, then speaks deltas', alone, async () => {
  let a = uid(), b = uid(), c1 = uid(), c2 = uid()
  // Two targets pre-seeded: a carries one comment before the sub opens.
  assertEquals(await post([{ eid: a, name: 'doc', comp: { title: 'a' } }]), 200)
  assertEquals(await post([{ eid: b, name: 'doc', comp: { title: 'b' } }]), 200)
  assertEquals(await post(comment(c1, a)), 200)

  let { sock, next } = await dial('.comment!&.tally=comment.target')
  // The initial frame is the standing tally, whole.
  assertEquals((await next()).agg?.[a], 1)

  // A birth arrives as a delta for its target alone.
  assertEquals(await post(comment(c2, b)), 200)
  assertEquals((await next()).agg, { [b]: 1 })

  // Retargeting moves both keys in one frame.
  assertEquals(
    await post([{ eid: c2, name: 'comment', comp: { target: a } }]),
    200,
  )
  assertEquals((await next()).agg, { [a]: 2, [b]: 0 })

  // A death drops its key toward zero.
  assertEquals(await post([{ eid: c1, name: 'entity', comp: null }]), 200)
  assertEquals((await next()).agg, { [a]: 1 })

  sock.close()
  await new Promise((r) => sock.onclose = r)
})

// The board TILE's shape (T-22509): the tile renders four status counts, so it
// subscribes to four numbers. A status move re-answers the tally from the index
// and ships only the two keys that moved — the board's members never appear.
slow(
  'a board tile tally follows a status move, members absent',
  alone,
  async () => {
    let p = uid(), t1 = uid(), t2 = uid()
    let task = (eid: string, status: string) => [
      { eid, name: 'doc', comp: { title: 'work', body: '' } },
      { eid, name: 'task', comp: { status, project: p } },
    ]
    assertEquals(await post([{ eid: p, name: 'project', comp: {} }]), 200)
    assertEquals(await post(task(t1, 'open')), 200)
    assertEquals(await post(task(t2, 'open')), 200)

    let q = `.task.project=${p}&.tally=task.status`
    let { sock, next } = await dial(q, 'agg:tile')
    assertEquals((await next()).agg, { open: 2 })

    // A status move: one recompute, one frame, both moved keys.
    assertEquals(
      await post([{ eid: t1, name: 'task', comp: { status: 'wip' } }]),
      200,
    )
    assertEquals((await next()).agg, { open: 1, wip: 1 })

    // A write to a component the line does NOT read must not stir the aggregate;
    // the next frame the sub speaks is the one after it.
    assertEquals(
      await post([{ eid: t2, name: 'doc', comp: { title: 'retitled' } }]),
      200,
    )
    assertEquals(await post([{ eid: t2, name: 'entity', comp: null }]), 200)
    assertEquals((await next()).agg, { open: 0 })

    sock.close()
    await new Promise((r) => sock.onclose = r)
  },
)

// `.count!` is the same machinery reduced to one number, under the empty key.
slow('a count sub answers one number and maintains it', alone, async () => {
  let p = uid(), t1 = uid(), t2 = uid()
  let task = (eid: string) => [
    { eid, name: 'doc', comp: { title: 'c', body: '' } },
    { eid, name: 'task', comp: { project: p } },
  ]
  assertEquals(await post([{ eid: p, name: 'project', comp: {} }]), 200)
  assertEquals(await post(task(t1)), 200)

  let { sock, next } = await dial(
    `.task.project=${p}&.count!`,
    'agg:count',
  )
  assertEquals((await next()).agg, { '': 1 })

  assertEquals(await post(task(t2)), 200)
  assertEquals((await next()).agg, { '': 2 })

  // Leaving the selection counts the same as dying.
  assertEquals(
    await post([{ eid: t2, name: 'task', comp: { project: null } }]),
    200,
  )
  assertEquals((await next()).agg, { '': 1 })

  sock.close()
  await new Promise((r) => sock.onclose = r)
})

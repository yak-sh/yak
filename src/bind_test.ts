// The peer policy is driven against live listeners: its failure is a server
// that booted happily. The race test pauses the first empty-address probe so
// a second boot reaches the exact check-then-bind window. The permissive cases
// are load-bearing too — a refusal-only suite would brick the deploy handoff.
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { alone, bound, guard, peer, same } from './bind.ts'
import { slow } from './testing.ts'

let answers = (body: unknown, status = 200) => {
  let http = Deno.serve({
    hostname: '127.0.0.1',
    port: 0,
    onListen: () => {},
  }, () => Response.json(body, { status }))
  return { port: (http.addr as Deno.NetAddr).port, http }
}

let free = () => {
  let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (seat.addr as Deno.NetAddr).port
  seat.close()
  return port
}

let finding = <T>(value: T) => () => Promise.resolve(value)

// An instant stand-in for the join-path retry delay, so the retrying cases
// prove their logic without waiting real seconds.
let now = () => Promise.resolve()

slow('same: a path holds one graph, :memory: holds none', () => {
  assertEquals(same('/t/tasks.db', '/t/tasks.db'), true)
  assertEquals(same('/t/tasks.db', '/t/./tasks.db'), true)
  assertEquals(same('/t/tasks.db', '/other/tasks.db'), false)
  // Two in-memory graphs share the name and no bytes.
  assertEquals(same(':memory:', ':memory:'), false)
})

slow('peer: an empty address and a stranger both read as nobody', async () => {
  assertEquals(await peer(free()), null)
  let { port, http } = answers({ not: 'a graph' }, 404)
  try {
    assertEquals(await peer(port), null)
  } finally {
    await http.shutdown()
  }
})

slow('alone: --join takes the same file — the deploy handoff', async () => {
  let { port, http } = answers({ db: '/t/tasks.db', epoch: 'e', pid: 7 })
  try {
    assertEquals((await alone(port, '/t/tasks.db', true))?.pid, 7)
  } finally {
    await http.shutdown()
  }
})

slow(
  'alone: the same file without --join is refused, naming the way in',
  async () => {
    let { port, http } = answers({ db: '/t/tasks.db', epoch: 'e', pid: 7 })
    try {
      let e = await assertRejects(() => alone(port, '/t/tasks.db'))
      assertStringIncludes((e as Error).message, '/t/tasks.db')
      assertStringIncludes((e as Error).message, 'DB_PATH')
      assertStringIncludes((e as Error).message, '--join')
    } finally {
      await http.shutdown()
    }
  },
)

slow(
  'alone: an empty address admits a first boot, not a successor',
  async () => {
    assertEquals(await alone(free(), '/t/tasks.db'), null)
    // A join with no predecessor still fails — after the patience runs out.
    await assertRejects(() => alone(free(), '/t/tasks.db', true, peer, 5, now))
  },
)

slow(
  'alone: a busy peer that answers late is joined, not abandoned',
  async () => {
    // The incumbent misses the first probe (mid-swap burst) then answers. A
    // first boot would have failed open to alone(); the successor waits and
    // joins instead of dying before ready (T-14308).
    let serving = { db: '/t/tasks.db', epoch: 'e', pid: 7 }
    let calls = 0
    let flaky = () => Promise.resolve(calls++ < 2 ? null : serving)
    assertEquals(
      (await alone(9999, '/t/tasks.db', true, flaky, 5, now))?.pid,
      7,
    )
    assertEquals(calls, 3) // two empty answers, then the join takes
  },
)

slow('alone: a first boot never waits on a missing peer', async () => {
  // join=false skips the retry entirely: one probe, then proceed alone.
  let calls = 0
  let count = () => (calls++, Promise.resolve(null))
  assertEquals(await alone(9999, '/t/tasks.db', false, count, 5, now), null)
  assertEquals(calls, 1)
})

slow('alone: a peer over another file is refused, naming both', async () => {
  let { port, http } = answers({ db: '/live/tasks.db', epoch: 'e', pid: 7 })
  try {
    let e = await assertRejects(() => alone(port, '/probe/tasks.db'))
    assertStringIncludes((e as Error).message, '/live/tasks.db')
    assertStringIncludes((e as Error).message, '/probe/tasks.db')
    assertStringIncludes((e as Error).message, 'PORT')
  } finally {
    await http.shutdown()
  }
})

slow('alone: --join is no licence to sit beside a stranger', async () => {
  let { port, http } = answers({ db: '/live/tasks.db', epoch: 'e', pid: 7 })
  try {
    await assertRejects(() => alone(port, '/probe/tasks.db', true))
  } finally {
    await http.shutdown()
  }
})

slow(
  'guard: simultaneous boots cannot both check an empty address',
  async () => {
    let port = free()
    let entered = Promise.withResolvers<void>()
    let resume = Promise.withResolvers<void>()
    let first = guard(port, '/t/tasks.db', false, async () => {
      entered.resolve()
      await resume.promise
      return null
    })
    await entered.promise
    try {
      for (let mine of ['/t/tasks.db', '/other/tasks.db']) {
        let e = await assertRejects(() =>
          guard(port, mine, false, finding(null))
        )
        assertStringIncludes((e as Error).message, 'already being claimed')
      }
      using _other = await guard(free(), '/t/tasks.db', false, finding(null))
    } finally {
      resume.resolve()
    }
    using _first = await first
  },
)

slow('guard: the successor keeps the lock through the handoff', async () => {
  let port = free()
  let serving = { db: '/t/tasks.db', epoch: 'e', pid: 7 }
  let first = await guard(port, '/t/tasks.db', false, finding(null))
  bound(first)
  await assertRejects(() =>
    guard(port, '/other/tasks.db', true, finding(serving))
  )
  let next = await guard(port, '/t/tasks.db', true, finding(serving))
  first.close()
  try {
    await assertRejects(() =>
      guard(port, '/t/tasks.db', false, finding(serving))
    )
  } finally {
    next.close()
  }
  await assertRejects(() =>
    guard(port, '/t/tasks.db', true, finding(null), 5, now)
  )
  using _after = await guard(port, '/t/tasks.db', false, finding(null))
})

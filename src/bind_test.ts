// The peer policy is driven against live listeners: its failure is a server
// that booted happily. The race test pauses the first empty-address probe so
// a second boot reaches the exact check-then-bind window.
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { alone, guard, peer, same } from './bind.ts'
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

slow(
  'alone: the same file is refused, naming the way in',
  async () => {
    let { port, http } = answers({ db: '/t/tasks.db', epoch: 'e', pid: 7 })
    try {
      let e = await assertRejects(() => alone(port, '/t/tasks.db'))
      assertStringIncludes((e as Error).message, '/t/tasks.db')
      assertStringIncludes((e as Error).message, 'Stop that server')
    } finally {
      await http.shutdown()
    }
  },
)

slow('alone: a first boot never waits on a missing peer', async () => {
  let calls = 0
  let count = () => (calls++, Promise.resolve(null))
  assertEquals(await alone(9999, '/t/tasks.db', count), null)
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

slow(
  'guard: simultaneous boots cannot both check an empty address',
  async () => {
    let port = free()
    let entered = Promise.withResolvers<void>()
    let resume = Promise.withResolvers<void>()
    let first = guard(port, '/t/tasks.db', async () => {
      entered.resolve()
      await resume.promise
      return null
    })
    await entered.promise
    try {
      for (let mine of ['/t/tasks.db', '/other/tasks.db']) {
        let e = await assertRejects(() => guard(port, mine, finding(null)))
        assertStringIncludes((e as Error).message, 'already being claimed')
      }
      using _other = await guard(free(), '/t/tasks.db', finding(null))
    } finally {
      resume.resolve()
    }
    using _first = await first
  },
)

slow(
  'guard: the serving process keeps an exclusive lifetime claim',
  async () => {
    let port = free()
    let first = await guard(port, '/t/tasks.db', finding(null))
    try {
      await assertRejects(() => guard(port, '/t/tasks.db', finding(null)))
    } finally {
      first.close()
    }
    using _after = await guard(port, '/t/tasks.db', finding(null))
  },
)

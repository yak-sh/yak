// The check exists to stop a SILENT join, so every case is driven against a
// live listener rather than a stub: the failure it prevents is a server that
// booted happily. The permissive cases are the load-bearing ones — a check
// that refused everything would pass a refusal-only suite and brick the
// deploy handoff, so each refusal is paired with the join it must allow.
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { alone, peer, same } from './bind.ts'

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

Deno.test('same: a path holds one graph, :memory: holds none', () => {
  assertEquals(same('/t/tasks.db', '/t/tasks.db'), true)
  assertEquals(same('/t/tasks.db', '/t/./tasks.db'), true)
  assertEquals(same('/t/tasks.db', '/other/tasks.db'), false)
  // Two in-memory graphs share the name and no bytes.
  assertEquals(same(':memory:', ':memory:'), false)
})

Deno.test('peer: an empty address and a stranger both read as nobody', async () => {
  assertEquals(await peer(free()), null)
  let { port, http } = answers({ not: 'a graph' }, 404)
  try {
    assertEquals(await peer(port), null)
  } finally {
    await http.shutdown()
  }
})

Deno.test('alone: a peer over the same file is the handoff, and joins', async () => {
  let { port, http } = answers({ db: '/t/tasks.db', epoch: 'e', pid: 7 })
  try {
    assertEquals((await alone(port, '/t/tasks.db'))?.pid, 7)
  } finally {
    await http.shutdown()
  }
})

Deno.test('alone: an empty address joins', async () => {
  assertEquals(await alone(free(), '/t/tasks.db'), null)
})

Deno.test('alone: a peer over another file is refused, naming both', async () => {
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

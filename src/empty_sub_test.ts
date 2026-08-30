// An empty-query subscription answers the EMPTY SET: an empty query selects
// nothing (query.ts parseQuery mints the never-pred), so the reply is a cheap
// empty replace — never match-all, which on the live graph staged every entity
// and shipped tens of MB. A route sub keeps its name-scoped answer.

import { assertEquals } from '@std/assert'
import { slow } from './testing.ts'

Deno.env.set('DB_PATH', ':memory:')

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
  changes?: unknown[]
  replace?: boolean
  error?: string
}

let dial = async () => {
  let sock = new WebSocket(`ws://${U}/ws`)
  let queue: Frame[] = []
  let waiters: ((f: Frame) => void)[] = []
  sock.onmessage = (m) => {
    let f = JSON.parse(String(m.data)) as Frame
    if (!f.sub) return
    let w = waiters.shift()
    w ? w(f) : queue.push(f)
  }
  await new Promise((r) => sock.onopen = r)
  let next = () =>
    queue.length
      ? Promise.resolve(queue.shift()!)
      : new Promise<Frame>((r) => waiters.push(r))
  return { sock, next }
}

slow(
  'an empty-query sub answers the empty set — nothing was selected',
  alone,
  async () => {
    let { sock, next } = await dial()
    sock.send(JSON.stringify({ sub: 'board:nope', q: '' }))
    let f = await next()
    assertEquals(f.sub, 'board:nope')
    assertEquals(f.changes, [])
    assertEquals(f.replace, true)
    assertEquals(f.error, undefined)
    sock.close()
  },
)

slow(
  'a route sub still answers its one entity with no query',
  alone,
  async () => {
    let eid = uid()
    let res = await fetch(`http://${U}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ eid, name: 'doc', comp: { title: 'routed' } }]),
    })
    await res.text()
    assertEquals(res.status, 200)
    let { sock, next } = await dial()
    sock.send(JSON.stringify({ sub: `route:${eid}`, q: '' }))
    let f = await next()
    assertEquals(f.sub, `route:${eid}`)
    assertEquals(f.error, undefined)
    let eids = new Set((f.changes as { eid: string }[]).map((c) => c.eid))
    assertEquals(eids, new Set([eid]))
    sock.close()
  },
)

slow('a filtered sub still answers normally', alone, async () => {
  let { sock, next } = await dial()
  sock.send(JSON.stringify({ sub: 'board:tasks', q: '.task!' }))
  let f = await next()
  assertEquals(f.sub, 'board:tasks')
  assertEquals(f.error, undefined)
  assertEquals(f.replace, true)
  sock.close()
})

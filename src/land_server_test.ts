// A landing refusal crosses one narrow server action because error is stamped,
// never wire-writable. The caller identifies only itself; the server resolves
// that session, journals and broadcasts the health facet, and a later success
// clears the signal it owns.
import { assertEquals } from '@std/assert'

let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
let port = (seat.addr as Deno.NetAddr).port
seat.close()
Deno.env.set('PORT', String(port))
Deno.env.set('DB_PATH', ':memory:')
await import('./server.ts')

let U = `127.0.0.1:${port}`
let alone = { sanitizeOps: false, sanitizeResources: false }
let sid = crypto.randomUUID()
let eid = crypto.randomUUID()

let post = (path: string, body: unknown, via?: string) =>
  fetch(`http://${U}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(via ? { 'x-via': via } : {}),
    },
    body: JSON.stringify(body),
  })

let error = async () => {
  let snap = await fetch(`http://${U}/snapshot`).then((r) => r.json()) as {
    changes: {
      eid: string
      name: string
      comp: Record<string, unknown> | null
    }[]
  }
  return snap.changes.find((c) => c.eid == eid && c.name == 'error')?.comp
}

Deno.test('land refusal stamps only the calling session', alone, async () => {
  let made = await post('/apply', [{
    eid,
    name: 'session',
    comp: { id: sid },
  }])
  assertEquals(made.status, 200)

  let message = 'UNLANDED: 1 commit on session/S-7 not in main — gate red'
  let refused = await post('/land', { error: message }, sid)
  assertEquals(refused.status, 204)
  assertEquals((await error())?.message, message)
  let stranded = await fetch(`http://${U}/query?kind=session&.error!`)
    .then((r) => r.json()) as { entity: { eid: string } }[]
  assertEquals(stranded.map((r) => r.entity.eid), [eid])

  let healthy = await post('/land', { error: null }, sid)
  assertEquals(healthy.status, 204)
  assertEquals(await error(), undefined)
})

Deno.test('land outcome refuses an unidentified caller', alone, async () => {
  let res = await post('/land', {
    error: 'UNLANDED: 1 commit on branch not in main',
  })
  assertEquals(res.status, 400)
  assertEquals(await error(), undefined)
})

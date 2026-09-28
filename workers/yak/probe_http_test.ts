// The probe relay is a browser origin: every HTTP request, including one
// after keep-alive, reaches the same app and person.
import { assertEquals } from '@std/assert'
import { relay } from './probe.ts'

Deno.test('relay keeps the app and person across browser requests', async () => {
  let upstream = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    async (req) =>
      Response.json({
        host: req.headers.get('x-yak-host'),
        cookie: req.headers.get('cookie'),
        origin: req.headers.get('origin'),
        body: [...new Uint8Array(await req.arrayBuffer())],
      }),
  )
  let port = (upstream.addr as Deno.NetAddr).port
  let wire = await relay(
    { base: `http://127.0.0.1:${port}` },
    'probe.yaks.app',
    'yak_session=probe',
    'https://probe.yaks.app',
  )
  try {
    for (let i = 0; i < 3; i++) {
      let r = await fetch(`${wire.origin}/vale/api/query?.player`)
      assertEquals(r.status, 200)
      assertEquals(await r.json(), {
        host: 'probe.yaks.app',
        cookie: 'yak_session=probe',
        origin: 'https://probe.yaks.app',
        body: [],
      })
    }
    let body = new Uint8Array([
      255,
      0,
      13,
      10,
      99,
      111,
      111,
      107,
      105,
      101,
      58,
      32,
      111,
      108,
      100,
      13,
      10,
    ])
    let posted = await fetch(`${wire.origin}/vale/api/apply`, {
      method: 'POST',
      body,
    })
    assertEquals((await posted.json()).body, [...body])
  } finally {
    await wire.stop()
    await upstream.shutdown()
  }
})

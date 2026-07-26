// The supervisor trusts a child only after its private ready handshake. This
// probe uses a tiny child instead of booting the graph server.
import { assertEquals } from '@std/assert'
import { launch } from './dev.ts'

Deno.test('launch: returns a child only after its ready signal', async () => {
  let js = `
    let port = Number(Deno.env.get('TASKS_READY_PORT'))
    using conn = await Deno.connect({hostname: '127.0.0.1', port})
    await conn.write(new Uint8Array([1]))
  `
  let child = await launch(Deno.execPath(), [
    'eval',
    js,
  ])
  assertEquals((await child.status).success, true)
})

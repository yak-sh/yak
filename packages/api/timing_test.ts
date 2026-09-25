/// <reference lib="deno.ns" />
// One line per response, the server's own `Server-Timing` printed as it
// arrived.

import { assertEquals } from '@std/assert'
import { timed } from './timing.ts'

Deno.test('one line per answer, the header verbatim', async () => {
  let said: string[] = []
  let go = (r: Request) =>
    new Response('{}', {
      status: 200,
      headers: r.url.endsWith('/mcp')
        ? { 'server-timing': 'door;dur=12, hops;dur=3, total;dur=41' }
        : {},
    })
  let say = (line: string) => said.push(line)
  await timed(say, go)(
    new Request('https://yaks.app/mcp', { method: 'POST', body: '{}' }),
  )
  assertEquals(said, ['POST /mcp 200  door;dur=12, hops;dur=3, total;dur=41'])
  // A door that sends no timing is still one line.
  await timed(say, go)(new Request('https://yaks.app/api/fee?all=1'))
  assertEquals(said[1], 'GET /api/fee?all=1 200')
})

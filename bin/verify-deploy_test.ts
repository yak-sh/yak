// The verifier's pure seams over a fake fetch: what counts as a good door, a
// good connector answer, and a fault in a line of tail. The live site and the
// wrangler subprocess are the impure edges and are not exercised here — the
// point of the fake is that a check can be wrong without a deploy being wrong.
import { assertEquals } from '@std/assert'
import { connector, DOORS, fault, verify } from './verify-deploy.ts'

let SITE = 'https://yaks.app'

// A fetch that answers from a table: path → [status, body]. Anything not in
// the table 404s, so a missed door shows up as a failure rather than a pass.
let fake = (table: Record<string, [number, string]>) =>
  ((url: string | URL | Request, init?: RequestInit) => {
    let path = new URL(String(url)).pathname
    let [status, body] =
      table[init?.method == 'POST' ? `POST ${path}` : path] ??
        [404, '']
    return Promise.resolve(new Response(body, { status }))
  }) as typeof fetch

let TOOLS = JSON.stringify({ result: { tools: [{ name: 'about' }] } })

let healthy = () => {
  let table: Record<string, [number, string]> = { 'POST /mcp': [200, TOOLS] }
  for (let path of DOORS) table[path] = [200, '$4 a month']
  return table
}

Deno.test('verify: every door 200 and about listed is silence', async () => {
  assertEquals(await verify(fake(healthy()), SITE), [])
})

Deno.test('verify: a door that moved names itself and its status', async () => {
  let table = healthy()
  table['/pricing'] = [500, '']
  assertEquals(await verify(fake(table), SITE), ['/pricing: 500, want 200'])
})

Deno.test('verify: a door that vanished is a 404, not a crash', async () => {
  let table = healthy()
  delete table['/connect']
  assertEquals(await verify(fake(table), SITE), ['/connect: 404, want 200'])
})

Deno.test('verify: pricing must show the price and hide the checkout door', async () => {
  let bare = healthy()
  bare['/pricing'] = [200, 'free forever']
  assertEquals(await verify(fake(bare), SITE), ['/pricing: no $4 on the page'])

  let leaky = healthy()
  leaky['/pricing'] = [200, '$4 at checkout.stripe.com/c/pay']
  assertEquals(await verify(fake(leaky), SITE), [
    '/pricing: leaks checkout.stripe.com',
  ])
})

Deno.test('connector: 200 without `about` is a failure, and names what it got', async () => {
  let table = healthy()
  table['POST /mcp'] = [
    200,
    JSON.stringify({ result: { tools: [{ name: 'x' }] } }),
  ]
  assertEquals(
    await connector(fake(table), SITE),
    '/mcp: tools/list has no `about` (x)',
  )

  table['POST /mcp'] = [200, 'not json']
  assertEquals(
    await connector(fake(table), SITE),
    '/mcp: tools/list has no `about` (nothing)',
  )
})

Deno.test('connector: the auth challenge is a failure here — this door is public', async () => {
  let table = healthy()
  table['POST /mcp'] = [401, '']
  assertEquals(await connector(fake(table), SITE), '/mcp: 401, want 200')
})

Deno.test('verify: a fetch that throws is reported, not thrown', async () => {
  let dead = (() => Promise.reject(new Error('dns'))) as typeof fetch
  assertEquals((await verify(dead, SITE)).length, DOORS.length + 1)
})

Deno.test('fault: 5xx and exceptions are ours, 4xx is not', () => {
  assertEquals(fault({ event: { response: { status: 200 } } }), null)
  assertEquals(fault({ event: { response: { status: 404 } } }), null)
  assertEquals(fault({ event: { response: { status: 499 } } }), null)
  assertEquals(
    fault({ event: { response: { status: 503 }, request: { url: '/mcp' } } }),
    '5xx /mcp',
  )
  assertEquals(
    fault({
      exceptions: [{ name: 'TypeError', message: 'x is not a function' }],
    }),
    'TypeError: x is not a function',
  )
  assertEquals(fault({}), null) // a cron or a tail keepalive carries no response
})

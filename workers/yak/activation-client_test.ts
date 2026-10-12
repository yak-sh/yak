import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { activationClient } from './activation-client.ts'

let head = 'a'.repeat(40), newer = 'b'.repeat(40)
let path = '/accounts/acct/workers/scripts/yak'
let upload = (method = 'PUT', suffix = '') =>
  new Request(`http://localhost/client/v4${path}${suffix}?excludeScript=true`, {
    method,
    headers: { authorization: 'Bearer build', 'content-type': 'text/plain' },
    body: 'prepared upload',
  })

let fixture = () => {
  let live = { id: 'before', commit: head }
  let calls: Request[] = []
  let gate: (request: Request) => Response | Promise<Response> = () =>
    Response.json({ success: true, result: { deployment_id: 'uploaded' } })
  let ask = (async (input, init) => {
    let request = new Request(input, init)
    calls.push(request)
    if (new URL(request.url).hostname == 'yaks.app') return await gate(request)
    return Response.json({
      success: true,
      result: {
        deployments: [{
          id: live.id,
          created_on: '2026-10-12T00:00:00Z',
          annotations: { 'workers/message': live.commit },
          versions: [{ version_id: 'v', percentage: 100 }],
        }],
      },
    })
  }) as typeof fetch
  return {
    live,
    calls,
    ask,
    gate: (run: typeof gate) => {
      gate = run
    },
  }
}

for (let [method, suffix] of [['PUT', ''], ['POST', '/deployments']]) {
  test(`a ${method} activation retries a changed deployment and refuses a newer live commit`, async () => {
    let f = fixture()
    let client = activationClient(
      'acct',
      head,
      (commits) =>
        Promise.resolve(
          commits.includes(newer) ? 'newer commit is live' : null,
        ),
      f.ask,
    )
    f.gate(async (request) => {
      assertEquals(request.headers.get('x-yak-deployment'), 'before')
      assertEquals(request.headers.get('x-yak-commit'), head)
      assertEquals(await request.text(), 'prepared upload')
      f.live.id = 'after'
      f.live.commit = newer
      return new Response(null, {
        status: 409,
        headers: { 'x-yak-activation-conflict': '1' },
      })
    })
    let response = await client.fetch(upload(method, suffix))
    assertEquals(response.status, 409)
    assertEquals(client.skipped, true)
    assertEquals(
      f.calls.filter((r) => new URL(r.url).hostname == 'yaks.app').length,
      1,
    )
    assertEquals(
      f.calls.some((r) =>
        r.method == method &&
        new URL(r.url).hostname == 'api.cloudflare.com'
      ),
      false,
    )
  })
}

test('an activation conflict rechecks ancestry and preserves the prepared upload', async () => {
  let f = fixture(), inspected = 0, activated = 0
  let client = activationClient('acct', head, () => {
    inspected++
    return Promise.resolve(null)
  }, f.ask)
  f.gate(async (request) => {
    assertEquals(await request.text(), 'prepared upload')
    if (++activated == 1) {
      f.live.id = 'same-commit'
      return new Response(null, {
        status: 409,
        headers: { 'x-yak-activation-conflict': '1' },
      })
    }
    assertEquals(request.headers.get('x-yak-deployment'), 'same-commit')
    return new Response('activated')
  })
  let response = await client.fetch(upload())
  assertEquals(await response.text(), 'activated')
  assertEquals({ inspected, activated, skipped: client.skipped }, {
    inspected: 2,
    activated: 2,
    skipped: false,
  })
})

test('a version upload reaches Cloudflare without activating through the gate', async () => {
  let f = fixture()
  let client = activationClient(
    'acct',
    head,
    () => Promise.reject('unexpected'),
    f.ask,
  )
  await client.fetch(upload('POST', '/versions'))
  assertEquals(f.calls.length, 1)
  assertEquals(
    f.calls[0].url,
    `https://api.cloudflare.com/client/v4${path}/versions?excludeScript=true`,
  )
  assertEquals(f.calls[0].headers.get('authorization'), 'Bearer build')
})

test('an activation never falls back when its shared gate is unavailable', async () => {
  let f = fixture()
  let client = activationClient(
    'acct',
    head,
    () => Promise.resolve(null),
    f.ask,
  )
  f.gate(() => new Response('unavailable', { status: 503 }))
  assertEquals((await client.fetch(upload())).status, 503)
  assertEquals(client.skipped, false)
  assertEquals(f.calls.length, 2)
})

test('the API proxy preserves decoded bytes and credentials across HTTP framing', async () => {
  let client = activationClient(
    'acct',
    head,
    () => Promise.resolve(null),
    ((input) => {
      let request = new Request(input)
      assertEquals(request.headers.get('host'), null)
      assertEquals(request.headers.get('authorization'), 'Bearer build')
      return Promise.resolve(
        new Response('decoded response', {
          headers: {
            'content-encoding': 'gzip',
            'content-length': '7',
            'content-type': 'application/json',
          },
        }),
      )
    }) as typeof fetch,
  )
  let request = new Request(`http://localhost/client/v4${path}/versions`, {
    headers: { host: 'localhost', authorization: 'Bearer build' },
  })
  let response = await client.fetch(request)
  assertEquals(await response.text(), 'decoded response')
  assertEquals(response.headers.get('content-encoding'), null)
  assertEquals(response.headers.get('content-length'), null)
  assertEquals(response.headers.get('content-type'), 'application/json')
})

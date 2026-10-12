import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { SENTINEL } from '@yaks/secrets'
import { granted, Refused } from './mod.ts'

let KEY = SENTINEL + 'A'.repeat(43)
let OTHER = SENTINEL + 'B'.repeat(43)
let grants = [{ sentinel: KEY, value: 'clé', hosts: ['api.example'] }]
let bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((p) =>
      typeof p == 'string' ? [...new TextEncoder().encode(p)] : p
    ),
  )
let seen: Request[] = []
let send: typeof fetch = (input, init) => {
  seen.push(new Request(input, init))
  return Promise.resolve(new Response(null, { status: 302 }))
}

// Warm the request/body machinery outside the budgeted cases.
await granted(
  grants,
  new Request('https://api.example/', {
    method: 'POST',
    body: bytes([0xff], KEY),
  }),
  send,
)

test('a granted credential replaces sentinels while preserving body bytes and refusing redirect following', async () => {
  seen = []
  let response = await granted(
    grants,
    new Request(`https://api.example/${KEY}?k=${KEY}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'x-other': 'kept' },
      body: bytes([0xff, 0], KEY, [0xfe]),
      redirect: 'follow',
    }),
    send,
  )
  let [out] = seen
  assertEquals(response.status, 302)
  assertEquals(out.url, 'https://api.example/cl%C3%A9?k=cl%C3%A9')
  assertEquals(out.headers.get('authorization'), 'Bearer clé')
  assertEquals(out.headers.get('x-other'), 'kept')
  assertEquals(out.redirect, 'manual')
  assertEquals(
    new Uint8Array(await out.arrayBuffer()),
    bytes([0xff, 0], 'clé', [0xfe]),
  )
})

for (
  let [why, url, headers, body] of [
    ['another host', `https://evil.example/?k=${KEY}`],
    ['another port', `https://api.example:8443/?k=${KEY}`],
    ['plain http', `http://api.example/?k=${KEY}`],
    ['an ungranted URL sentinel', `https://api.example/?k=${OTHER}`],
    ['an ungranted header sentinel', `https://api.example/?k=${KEY}`, {
      authorization: OTHER,
    }],
    ['an ungranted body sentinel', `https://api.example/?k=${KEY}`, {}, OTHER],
  ] as [string, string, HeadersInit?, string?][]
) {
  test(`granted refuses ${why} without sending`, async () => {
    seen = []
    await assertRejects(() =>
      granted(
        grants,
        new Request(url, {
          method: body ? 'POST' : 'GET',
          headers,
          body,
        }),
        send,
      ), Refused)
    assertEquals(seen, [])
  })
}

test('each found sentinel must be granted for the destination', async () => {
  seen = []
  await assertRejects(() =>
    granted(
      [
        ...grants,
        { sentinel: OTHER, value: 'other-key', hosts: ['other.example'] },
      ],
      new Request(`https://api.example/?k=${KEY}`, {
        headers: { authorization: OTHER },
      }),
      send,
    ), Refused)
  assertEquals(seen, [])
})

test('a grant unused by a request does not restrict its destination or redirects', async () => {
  seen = []
  await granted(
    grants,
    new Request('http://elsewhere.example/', {
      redirect: 'follow',
    }),
    send,
  )
  assertEquals(seen[0].url, 'http://elsewhere.example/')
  assertEquals(seen[0].redirect, 'follow')
})

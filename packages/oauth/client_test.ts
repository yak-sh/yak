// The authorization-code client against a scripted token endpoint: the link it
// builds, the exchange it makes, what it keeps, and when it refreshes.

import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  type AuthorizationStore,
  client,
  OAuthError,
  type Provider,
  type Tokens,
} from './mod.ts'

let PROVIDER: Provider = {
  authorize: 'https://auth.example/authorize',
  token: 'https://auth.example/token',
  scopes: ['calendar', 'email'],
  params: { access_type: 'offline', state: 'forged' },
  client: { id: 'app id', secret: 's3cret' },
}
let REDIRECT = 'https://yourname.yaks.app/_yaks/connections/back'

// A store that serializes updates, as the vault-backed one does.
let memory = (seed?: Tokens) => {
  let held = new Map<string, Tokens>(seed ? [['k', seed]] : [])
  let turn: Promise<unknown> = Promise.resolve()
  let store: AuthorizationStore<Tokens> = {
    read: (key) =>
      Promise.resolve(held.has(key) ? { ...held.get(key) } : undefined),
    update: (key, fn) => {
      let run = turn.then(async () => {
        let record = { ...held.get(key) }
        try {
          return await fn(record)
        } finally {
          held.set(key, JSON.parse(JSON.stringify(record)))
        }
      })
      turn = run.catch(() => {})
      return run
    },
  }
  return { store, held }
}

// A token endpoint that answers each request with the next scripted reply.
let endpoint = (...replies: [number, unknown][]) => {
  let seen: { headers: Headers; body: URLSearchParams }[] = []
  let fetch = (_: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      headers: new Headers(init?.headers),
      body: new URLSearchParams(String(init?.body)),
    })
    let [status, body] = replies.shift() ?? [500, {}]
    return Promise.resolve(Response.json(body, { status }))
  }
  return { fetch, seen }
}

let setup = (
  seed?: Tokens,
  replies: [number, unknown][] = [],
  provider = PROVIDER,
  at = 1_000_000,
) => {
  let m = memory(seed)
  let e = endpoint(...replies)
  let c = client(provider, {
    store: m.store,
    key: 'k',
    redirect: REDIRECT,
    fetch: e.fetch,
    now: () => at,
  })
  return { c, ...m, ...e }
}

let s256 = async (verifier: string) =>
  btoa(String.fromCharCode(
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  )).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

Deno.test('begin: the link carries the flow, and data cannot replace its state', async () => {
  let { c } = setup()
  let { url, attempt } = await c.begin()
  let q = new URL(url).searchParams
  assertEquals(new URL(url).origin + new URL(url).pathname, PROVIDER.authorize)
  assertEquals(q.get('response_type'), 'code')
  assertEquals(q.get('client_id'), 'app id')
  assertEquals(q.get('redirect_uri'), REDIRECT)
  assertEquals(q.get('state'), attempt.state)
  assertEquals(q.get('scope'), 'calendar email')
  assertEquals(q.get('access_type'), 'offline')
  assertEquals(q.get('code_challenge_method'), 'S256')
  assertEquals(q.get('code_challenge'), await s256(attempt.verifier))
  assertEquals(
    new URL((await c.begin(['one'])).url).searchParams.get('scope'),
    'one',
  )
})

Deno.test('complete: exchanges the code with the verifier and keeps the grant', async () => {
  let { c, held, seen } = setup(undefined, [[200, {
    access_token: 'A1',
    token_type: 'Bearer',
    refresh_token: 'R1',
    expires_in: 3600,
    scope: 'calendar',
  }]])
  let { attempt } = await c.begin()
  await c.complete(attempt, `${REDIRECT}?code=C&state=${attempt.state}`)
  let { headers, body } = seen[0]
  assertEquals(headers.get('authorization'), `Basic ${btoa('app+id:s3cret')}`)
  assertEquals(Object.fromEntries(body), {
    grant_type: 'authorization_code',
    code: 'C',
    redirect_uri: REDIRECT,
    code_verifier: attempt.verifier,
  })
  assertEquals(held.get('k'), {
    access_token: 'A1',
    token_type: 'Bearer',
    refresh_token: 'R1',
    expires_at: 1_000_000 + 3_600_000,
    scope: 'calendar',
  })
})

Deno.test('complete: a mismatched, refused, doubled or late return makes no request', async () => {
  let { c, seen } = setup()
  let { attempt } = await c.begin()
  let back = (q: string) => `${REDIRECT}?${q}`
  for (
    let [pending, url, code] of [
      [attempt, back('code=C&state=other'), 'state'],
      [
        attempt,
        back(`error=access_denied&state=${attempt.state}`),
        'access_denied',
      ],
      [attempt, back(`code=C&code=D&state=${attempt.state}`), 'code'],
      [
        { ...attempt, until: 0 },
        back(`code=C&state=${attempt.state}`),
        'expired',
      ],
    ] as const
  ) {
    let e = await assertRejects(() => c.complete(pending, url), OAuthError)
    assertEquals(e.code, code)
  }
  assertEquals(seen.length, 0)
})

Deno.test('token: a fresh token needs no request; a stale one refreshes once, keeping the refresh token', async () => {
  let fresh = setup({ access_token: 'A1', expires_at: 1_000_000 + 120_000 })
  assertEquals(await fresh.c.token(), 'A1')
  assertEquals(fresh.seen.length, 0)

  let stale = setup(
    { access_token: 'A1', refresh_token: 'R1', expires_at: 1_000_000 + 30_000 },
    [[200, { access_token: 'A2', expires_in: 3600 }]],
  )
  assertEquals(await Promise.all([stale.c.token(), stale.c.token()]), [
    'A2',
    'A2',
  ])
  assertEquals(stale.seen.length, 1)
  assertEquals(Object.fromEntries(stale.seen[0].body), {
    grant_type: 'refresh_token',
    refresh_token: 'R1',
  })
  assertEquals(stale.held.get('k')?.refresh_token, 'R1')
  assertEquals(await setup().c.token(), undefined)
})

Deno.test('refresh: after a refusal, unless another caller already replaced the token', async () => {
  let { c, seen } = setup(
    { access_token: 'A1', refresh_token: 'R1' },
    [[200, { access_token: 'A2', refresh_token: 'R2' }]],
  )
  assertEquals(await c.refresh('A1'), 'A2')
  assertEquals(await c.refresh('A1'), 'A2')
  assertEquals(seen.length, 1)
})

Deno.test('the provider refusing, by status or by an error field, is its code', async () => {
  for (
    let [reply, code] of [
      [[400, { error: 'invalid_grant' }], 'invalid_grant'],
      [[200, { error: 'bad_verification_code' }], 'bad_verification_code'],
      [[502, 'oops'], 'http_502'],
    ] as const
  ) {
    let { c } = setup({ access_token: 'A1', refresh_token: 'R1' }, [[...reply]])
    let e = await assertRejects(() => c.refresh('A1'), OAuthError)
    assertEquals(e.code, code)
  }
  let dead = setup({ access_token: 'A1', expires_at: 0 })
  assertEquals(
    (await assertRejects(() => dead.c.token(), OAuthError)).code,
    'expired',
  )
})

Deno.test('client credentials: in the body for post, the id alone for a public client', async () => {
  let cases: [Provider, Record<string, string>][] = [
    [{ ...PROVIDER, auth: 'post' }, {
      client_id: 'app id',
      client_secret: 's3cret',
    }],
    [{ ...PROVIDER, client: { id: 'app id' } }, { client_id: 'app id' }],
  ]
  for (let [provider, sent] of cases) {
    let { c, seen } = setup(
      { access_token: 'A1', refresh_token: 'R1' },
      [[200, { access_token: 'A2' }]],
      provider,
    )
    await c.refresh('A1')
    assert(!seen[0].headers.has('authorization'))
    assertEquals(Object.fromEntries(seen[0].body), {
      grant_type: 'refresh_token',
      refresh_token: 'R1',
      ...sent,
    })
  }
})

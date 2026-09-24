// The authorization-code client against a scripted token endpoint: the link it
// builds, the exchange it makes, what it keeps, and when it refreshes.

import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  type AuthorizationStore,
  client,
  OAuthError,
  pkce,
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

// A token endpoint that answers each request with the next scripted reply. The
// answer is as little of a Response as the client reads (ok, status, json): a
// web Response or Headers would cost the first test that builds one the
// process's whole fetch warm-up, which is not the client's time.
let endpoint = (...replies: [number, unknown][]) => {
  let seen: { headers: Record<string, string>; body: URLSearchParams }[] = []
  let fetch = (_: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      headers: { ...init?.headers as Record<string, string> },
      body: new URLSearchParams(String(init?.body)),
    })
    let [status, body] = replies.shift() ?? [500, {}]
    let ok = status >= 200 && status < 300
    return Promise.resolve({ ok, status, json: () => Promise.resolve(body) })
  }
  return { fetch: fetch as unknown as typeof globalThis.fetch, seen }
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

// Web Crypto's first digest and the first URL a process parses pay for
// starting those up (up to about 10ms cold), which would land on whichever test
// calls `begin` first. They are paid here, as the module loads, so each test's
// time is its own.
await pkce()
new URL('https://warm.example/?a=b').searchParams.set('c', 'd')

let s256 = async (verifier: string) =>
  btoa(String.fromCharCode(
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  )).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

Deno.test('begin: the link carries the flow, and data cannot replace its state', async () => {
  let { c } = setup()
  let { url, attempt } = await c.begin()
  let link = new URL(url)
  assertEquals(link.origin + link.pathname, PROVIDER.authorize)
  assertEquals(Object.fromEntries(link.searchParams), {
    access_type: 'offline',
    response_type: 'code',
    client_id: 'app id',
    redirect_uri: REDIRECT,
    state: attempt.state,
    code_challenge: await s256(attempt.verifier),
    code_challenge_method: 'S256',
    scope: 'calendar email',
  })
})

Deno.test("begin: the scopes asked for replace the provider's own", async () => {
  let { url } = await setup().c.begin(['one'])
  assertEquals(new URL(url).searchParams.get('scope'), 'one')
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
  assertEquals(headers.authorization, `Basic ${btoa('app+id:s3cret')}`)
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
    assert(!('authorization' in seen[0].headers))
    assertEquals(Object.fromEntries(seen[0].body), {
      grant_type: 'refresh_token',
      refresh_token: 'R1',
      ...sent,
    })
  }
})

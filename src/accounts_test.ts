// Provider-account tests drive the redacted state machine through injected
// stores and RPCs. Secrets appear only in the fake issuer's private calls.
import { assertEquals, assertRejects } from '@std/assert'
import { accountHttp, accountService, type AccountStatus } from './accounts.ts'
import type { AuthStore, Issuer, Rpc } from './codex_auth.ts'

let jwt = (account: string) => {
  let payload = btoa(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: account },
  })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return `header.${payload}.signature`
}

type Call = { method: string; params: Record<string, unknown> }
type Relay = (input: string | URL, init: RequestInit) => Promise<Response>

let fixture = (initial?: Record<string, unknown>) => {
  let account = initial
  let token = account?.type == 'chatgpt' ? jwt('account-secret') : undefined
  let rotate = true
  let calls: Call[] = []
  let commits = 0, closes = 0, begins = 0, refreshes = 0
  let login: {
    id: string
    emit: (params: Record<string, unknown>) => void
    update: (params: Record<string, unknown>) => void
  } | undefined
  let relay: Relay = () => Promise.resolve(new Response(null, { status: 302 }))
  let store: AuthStore = {
    begin: () => {
      begins++
      return Promise.resolve({
        home: `/account/${begins}`,
        commit: () => {
          commits++
          return Promise.resolve()
        },
        close: () => {
          closes++
          return Promise.resolve()
        },
      })
    },
  }
  let issuer: Issuer = {
    open: () => {
      let notes = new Map<string, Record<string, unknown>[]>()
      let waits = new Map<
        string,
        ReturnType<typeof Promise.withResolvers<Record<string, unknown>>>[]
      >()
      let emit = (method: string, params: Record<string, unknown>) => {
        let waiting = waits.get(method)?.shift()
        if (waiting) waiting.resolve(params)
        else notes.set(method, [...notes.get(method) ?? [], params])
      }
      let rpc: Rpc = {
        call: async (method, params = {}) => {
          calls.push({ method, params })
          if (method == 'account/read') return { account }
          if (method == 'account/rateLimits/read') {
            return {
              rateLimits: {
                primary: {
                  usedPercent: 12,
                  resetsAt: 44,
                  windowDurationMins: 300,
                },
                rateLimitReachedType: 'not_reached',
              },
            }
          }
          if (method == 'getAuthStatus') {
            if (params.refreshToken === true) {
              refreshes++
              if (rotate) token = jwt('account-refreshed')
              await Promise.resolve()
            }
            return { authToken: token }
          }
          if (method == 'account/login/start') {
            if (params.type == 'apiKey') {
              token = String(params.apiKey)
              account = { type: 'apiKey' }
              return {}
            }
            let id = `login-${calls.length}`
            login = {
              id,
              emit: (value) => emit('account/login/completed', value),
              update: (value) => emit('account/updated', value),
            }
            return params.type == 'chatgptDeviceCode'
              ? {
                loginId: id,
                verificationUrl: 'https://auth.example/device',
                userCode: 'ABCD-1234',
              }
              : {
                loginId: id,
                authUrl:
                  'https://auth.example/authorize?state=opaque&redirect_uri=' +
                  'http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback',
              }
          }
          if (method == 'account/login/cancel') return {}
          if (method == 'account/logout') {
            account = undefined
            token = undefined
            return {}
          }
          throw Error(`unexpected method ${method}`)
        },
        notify: () => Promise.resolve(),
        wait: (method) => {
          let queued = notes.get(method)?.shift()
          if (queued) return Promise.resolve(queued)
          let waiting = Promise.withResolvers<Record<string, unknown>>()
          waits.set(method, [...waits.get(method) ?? [], waiting])
          return waiting.promise
        },
        close: () => {
          for (let list of waits.values()) {
            for (let waiting of list) waiting.reject(Error('closed'))
          }
          waits.clear()
          return Promise.resolve()
        },
      }
      return Promise.resolve(rpc)
    },
  }
  let service = accountService(
    store,
    issuer,
    (input, init) => relay(input, init),
  )
  return {
    service,
    calls,
    counts: () => ({ begins, closes, commits, refreshes }),
    setToken: (value: string | undefined) => {
      token = value
      rotate = false
    },
    complete: (success = true, id = login?.id) => {
      if (!login) throw Error('no login')
      login.emit({ loginId: id, success })
    },
    updated: (authMode = 'chatgpt') => {
      if (!login) throw Error('no login')
      if (authMode == 'chatgpt') {
        account = {
          type: 'chatgpt',
          email: 'person@example.com',
          planType: 'plus',
        }
        token = jwt('account-secret')
      }
      login.update({ authMode })
    },
    onRelay: (run: Relay) => relay = run,
  }
}

let settle = async (
  status: () => Promise<AccountStatus>,
  state: AccountStatus['state'],
) => {
  for (let turn = 0; turn < 20; turn++) {
    let value = await status()
    if (value.state == state) return value
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw Error(`account did not settle as ${state}`)
}

Deno.test('Codex account status is redacted and refresh is single-flight', async () => {
  let run = fixture({
    type: 'chatgpt',
    email: 'person@example.com',
    planType: 'plus',
  })
  let status = await run.service.status()
  assertEquals(status, {
    provider: 'codex',
    state: 'ready',
    ready: true,
    auth: 'chatgpt',
    email: 'person@example.com',
    plan: 'plus',
    limits: {
      primary: { used: 12, resets_at: 44, window_minutes: 300 },
      reached: 'not_reached',
    },
  })
  assertEquals(JSON.stringify(status).includes('account-secret'), false)

  assertEquals(await run.service.credentials.get(), {
    token: jwt('account-secret'),
    account: 'account-secret',
    base: 'https://chatgpt.com/backend-api/codex',
  })
  let refreshed = await Promise.all(
    Array.from({ length: 20 }, () => run.service.credentials.refresh!()),
  )
  assertEquals(refreshed[0], {
    token: jwt('account-refreshed'),
    account: 'account-refreshed',
    base: 'https://chatgpt.com/backend-api/codex',
  })
  assertEquals(run.counts().refreshes, 1)
  assertEquals(run.counts().commits, 1)
})

Deno.test('Codex credential failures clear cached readiness and bearer', async () => {
  let run = fixture({ type: 'chatgpt' })
  await run.service.credentials.get()
  run.setToken(undefined)
  await assertRejects(
    run.service.credentials.refresh!,
    Error,
    'Codex is not signed in.',
  )
  assertEquals((await run.service.status()).state, 'signed_out')

  run.setToken('not-a-jwt')
  await assertRejects(
    run.service.credentials.get,
    Error,
    'Codex account service is unavailable.',
  )
  assertEquals((await run.service.status()).state, 'unavailable')
  assertEquals(
    run.calls.filter((call) => call.method == 'getAuthStatus').length,
    3,
  )
})

Deno.test('Codex login waits for its account update before commit', async () => {
  let run = fixture()
  let start = await run.service.login({ method: 'browser' })
  assertEquals(start, {
    method: 'browser',
    authorizationUrl:
      'https://auth.example/authorize?state=opaque&redirect_uri=' +
      'http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback',
  })
  assertEquals(JSON.stringify(start).includes('login-'), false)
  assertEquals((await run.service.status()).state, 'pending')

  run.complete()
  await Promise.resolve()
  assertEquals((await run.service.status()).state, 'pending')
  assertEquals(run.counts().commits, 0)
  run.updated()
  let ready = await settle(run.service.status, 'ready')
  assertEquals(ready.auth, 'chatgpt')
  assertEquals(run.counts().commits, 1)

  assertEquals(await run.service.logout(), {
    provider: 'codex',
    state: 'signed_out',
    ready: false,
    auth: null,
  })
  assertEquals(run.counts().commits, 2)
})

Deno.test('Codex browser login relays only its exact callback', async () => {
  let run = fixture()
  await run.service.login({ method: 'browser' })
  let request: { url: string; init: RequestInit } | undefined
  run.onRelay((input, init) => {
    request = { url: String(input), init }
    run.complete()
    run.updated()
    return Promise.resolve(
      new Response('provider body', {
        status: 302,
        headers: { location: 'https://provider.example/secret' },
      }),
    )
  })
  let response = await accountHttp(
    run.service,
    new Request('http://tasks/accounts/codex/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        callback: 'http://localhost:1455/auth/callback?code=grant&state=opaque',
      }),
    }),
  )
  let text = await response.text()
  let status: AccountStatus = JSON.parse(text)
  assertEquals(response.status, 200)
  assertEquals(status.state, 'ready')
  assertEquals(request, {
    url: 'http://localhost:1455/auth/callback?code=grant&state=opaque',
    init: { redirect: 'manual' },
  })
  assertEquals(text.includes('grant'), false)
  assertEquals(text.includes('opaque'), false)
})

Deno.test('Codex callback relay rejects every shape outside its ceremony', async () => {
  let absent = fixture()
  await assertRejects(
    () => absent.service.complete('http://localhost/callback?code=x&state=y'),
    Error,
    'No browser login is pending.',
  )
  await absent.service.login({ method: 'device' })
  await assertRejects(
    () => absent.service.complete('http://localhost/callback?code=x&state=y'),
    Error,
    'No browser login is pending.',
  )
  await absent.service.cancel()

  for (
    let value of [
      'https://localhost:1455/auth/callback?code=grant&state=opaque',
      'http://other:1455/auth/callback?code=grant&state=opaque',
      'http://localhost:1455/other?code=grant&state=opaque',
      'http://localhost:1455/auth/callback?code=grant&state=wrong',
      'http://localhost:1455/auth/callback?code=&state=opaque',
      'http://localhost:1455/auth/callback?code=a&code=b&state=opaque',
      'http://localhost:1455/auth/callback?code=a&state=opaque&state=opaque',
      'http://localhost:1455/auth/callback?code=a&state=opaque&scope=openid',
      'http://user@localhost:1455/auth/callback?code=a&state=opaque',
      'http://localhost:1455/auth/callback?code=a&state=opaque#token',
    ]
  ) {
    let run = fixture()
    await run.service.login({ method: 'browser' })
    let relays = 0
    run.onRelay(() => {
      relays++
      return Promise.resolve(new Response())
    })
    await assertRejects(
      () => run.service.complete(value),
      Error,
      'Invalid Codex login callback.',
    )
    assertEquals(relays, 0)
    await run.service.cancel()
  }
})

Deno.test('Codex browser login rejects an unrelated account update', async () => {
  let run = fixture()
  await run.service.login({ method: 'browser' })
  run.complete()
  run.updated('apiKey')
  let status = await settle(run.service.status, 'error')
  assertEquals(status.error, {
    code: 'login_failed',
    message: 'Codex login failed.',
  })
  assertEquals(run.counts().commits, 0)
})

Deno.test('Codex device login cancellation discards its transaction', async () => {
  let run = fixture()
  assertEquals(await run.service.login({ method: 'device' }), {
    method: 'device',
    verificationUrl: 'https://auth.example/device',
    userCode: 'ABCD-1234',
  })
  assertEquals((await run.service.cancel()).state, 'signed_out')
  assertEquals((await run.service.status()).state, 'signed_out')
  assertEquals(run.counts().commits, 0)
})

Deno.test('Codex login rejects a completion for another ceremony', async () => {
  let run = fixture()
  await run.service.login({ method: 'browser' })
  run.complete(true, 'other-login')
  let status = await settle(run.service.status, 'error')
  assertEquals(status.error, {
    code: 'login_failed',
    message: 'Codex login failed.',
  })
  assertEquals(run.counts().commits, 0)
})

Deno.test('Codex API-key login exposes no key and selects public Responses', async () => {
  let run = fixture()
  let secret = 'sk-provider-secret'
  let status = await run.service.login({ method: 'apiKey', apiKey: secret })
  assertEquals(status, {
    provider: 'codex',
    state: 'ready',
    ready: true,
    auth: 'apiKey',
  })
  assertEquals(JSON.stringify(status).includes(secret), false)
  assertEquals(await run.service.credentials.get(), {
    token: secret,
    base: 'https://api.openai.com/v1',
  })
})

Deno.test('Codex account HTTP surface is JSON-only, bounded, and no-store', async () => {
  let run = fixture()
  let get = await accountHttp(
    run.service,
    new Request('http://tasks/accounts/codex'),
  )
  assertEquals(get.status, 200)
  assertEquals(get.headers.get('cache-control'), 'no-store')
  assertEquals(get.headers.get('referrer-policy'), 'no-referrer')

  let wrongMethod = await accountHttp(
    run.service,
    new Request('http://tasks/accounts/codex/login'),
  )
  assertEquals(wrongMethod.status, 405)
  let extra = await accountHttp(
    run.service,
    new Request('http://tasks/accounts/codex/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'browser', extra: true }),
    }),
  )
  assertEquals(extra.status, 400)
  let large = await accountHttp(
    run.service,
    new Request('http://tasks/accounts/codex/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{"method":"apiKey","apiKey":"${'x'.repeat(9000)}"}`,
    }),
  )
  assertEquals(large.status, 400)
  assertEquals(await large.json(), {
    error: {
      code: 'invalid_request',
      message: 'Invalid Codex account request.',
    },
  })
})

Deno.test('Codex issuer failures cross the account boundary as fixed errors', async () => {
  let store: AuthStore = {
    begin: () => Promise.reject(Error('provider-secret-in-store')),
  }
  let service = accountService(store, {
    open: () => Promise.reject(Error('provider-secret-from-cli')),
  })
  let response = await accountHttp(
    service,
    new Request('http://tasks/accounts/codex'),
  )
  let text = await response.text()
  assertEquals(response.status, 200)
  assertEquals(text.includes('provider-secret'), false)
  assertEquals(JSON.parse(text).error, {
    code: 'unavailable',
    message: 'Codex account service is unavailable.',
  })
})

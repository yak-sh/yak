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

let fixture = (initial?: Record<string, unknown>, updateTimeout = 30_000) => {
  let account = initial
  let token = account?.type == 'chatgpt' ? jwt('account-secret') : undefined
  let rotate = true
  let calls: Call[] = []
  let commits = 0, closes = 0, begins = 0, refreshes = 0
  let commitError = false, readError = false
  let startError: Error | undefined
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
          if (commitError) return Promise.reject(Error('store path secret'))
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
          if (method == 'account/read') {
            if (readError) throw Error('account read failed')
            return { account }
          }
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
            if (startError) throw startError
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
    updateTimeout,
  )
  return {
    service,
    calls,
    counts: () => ({ begins, closes, commits, refreshes }),
    setToken: (value: string | undefined) => {
      token = value
      rotate = false
    },
    complete: (success = true, id = login?.id, error?: string) => {
      if (!login) throw Error('no login')
      login.emit({ loginId: id, success, ...(error ? { error } : {}) })
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
    failCommit: () => commitError = true,
    failRead: () => readError = true,
    failStart: (message: string) => {
      startError = Object.assign(new Error(message), {
        codexRpc: true as const,
      })
    },
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
      'The callback does not match this Codex login.',
    )
    assertEquals((await run.service.status()).error?.code, 'invalid_callback')
    assertEquals(relays, 0)
    await run.service.cancel()
  }
})

Deno.test('Codex callback delivery failures are named without provider bodies', async () => {
  let unreachable = fixture()
  await unreachable.service.login({ method: 'browser' })
  unreachable.onRelay(() => Promise.reject(Error('callback?code=secret')))
  try {
    await unreachable.service.complete(
      'http://localhost:1455/auth/callback?code=grant&state=opaque',
    )
    throw Error('accepted')
  } catch (error) {
    let value = error as Error & { code?: string }
    assertEquals(value.code, 'callback_unreachable')
    assertEquals(value.message.includes('secret'), false)
  }
  assertEquals(
    (await unreachable.service.status()).error?.code,
    'callback_unreachable',
  )
  await unreachable.service.cancel()

  let rejected = fixture()
  await rejected.service.login({ method: 'browser' })
  rejected.onRelay(() =>
    Promise.resolve(
      new Response('provider-body-secret', {
        status: 401,
        headers: { location: 'https://provider.example/location-secret' },
      }),
    )
  )
  try {
    await rejected.service.complete(
      'http://localhost:1455/auth/callback?code=grant&state=opaque',
    )
    throw Error('accepted')
  } catch (error) {
    let value = error as Error & { code?: string }
    assertEquals(value.code, 'callback_rejected')
    assertEquals(value.message.includes('HTTP 401'), true)
    assertEquals(value.message.includes('provider-body-secret'), false)
    assertEquals(value.message.includes('location-secret'), false)
  }
  assertEquals(
    (await rejected.service.status()).error?.code,
    'callback_rejected',
  )
  await rejected.service.cancel()
})

Deno.test('retrying a callback clears its prior error while delivery runs', async () => {
  let run = fixture()
  await run.service.login({ method: 'browser' })
  run.onRelay(() => Promise.reject(Error('offline')))
  await assertRejects(() =>
    run.service.complete(
      'http://localhost:1455/auth/callback?code=first&state=opaque',
    )
  )
  assertEquals((await run.service.status()).error?.code, 'callback_unreachable')

  let delivery = Promise.withResolvers<Response>()
  run.onRelay(() => delivery.promise)
  let completing = run.service.complete(
    'http://localhost:1455/auth/callback?code=second&state=opaque',
  )
  await Promise.resolve()
  assertEquals((await run.service.status()).error, undefined)
  run.complete()
  run.updated()
  delivery.resolve(new Response(null, { status: 302 }))
  assertEquals((await completing).state, 'ready')
})

Deno.test('Codex browser login rejects an unrelated account update', async () => {
  let run = fixture()
  await run.service.login({ method: 'browser' })
  run.complete()
  run.updated('apiKey')
  let status = await settle(run.service.status, 'error')
  assertEquals(status.error, {
    code: 'account_mode_mismatch',
    message:
      'Codex authorized the login in a mode other than ChatGPT. Start a new ChatGPT login and try again.',
  })
  assertEquals(run.counts().commits, 0)
})

Deno.test('Codex login failures keep a sanitized phase and explanation', async () => {
  let rejected = fixture()
  await rejected.service.login({ method: 'device' })
  rejected.complete(
    false,
    undefined,
    'Workspace denied device login; code=grant-secret ' +
      'account_id=account-secret',
  )
  let status = await settle(rejected.service.status, 'error')
  assertEquals(status.error?.code, 'login_rejected')
  assertEquals(status.error?.message.includes('Workspace denied'), true)
  assertEquals(JSON.stringify(status).includes('grant-secret'), false)
  assertEquals(JSON.stringify(status).includes('account-secret'), false)

  let disabled = fixture()
  disabled.failStart(
    'Device code login is disabled by workspace; token=provider-secret',
  )
  await assertRejects(
    () => disabled.service.login({ method: 'device' }),
    Error,
    'Codex device login is disabled.',
  )
  status = await disabled.service.status()
  assertEquals(status.error?.code, 'device_login_disabled')
  assertEquals(JSON.stringify(status).includes('provider-secret'), false)
})

Deno.test('Codex login names update, read, and credential-save failures', async () => {
  let timedOut = fixture(undefined, 1)
  await timedOut.service.login({ method: 'browser' })
  timedOut.complete()
  let status = await settle(timedOut.service.status, 'error')
  assertEquals(status.error?.code, 'account_update_timed_out')

  let unreadable = fixture()
  await unreadable.service.login({ method: 'browser' })
  unreadable.complete()
  unreadable.failRead()
  unreadable.updated()
  status = await settle(unreadable.service.status, 'error')
  assertEquals(status.error?.code, 'account_read_failed')

  let unsaved = fixture()
  await unsaved.service.login({ method: 'browser' })
  unsaved.complete()
  unsaved.failCommit()
  unsaved.updated()
  status = await settle(unsaved.service.status, 'error')
  assertEquals(status.error?.code, 'credential_save_failed')
  assertEquals(JSON.stringify(status).includes('store path secret'), false)
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
    code: 'login_mismatched',
    message:
      'Codex completed a different login attempt. Start a new login from this Tasks client.',
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

  let unsaved = fixture()
  unsaved.failCommit()
  await assertRejects(
    () => unsaved.service.login({ method: 'apiKey', apiKey: secret }),
    Error,
    'Codex could not complete API-key login.',
  )
  let failure = await unsaved.service.status()
  assertEquals(failure.error?.code, 'api_key_login_failed')
  assertEquals(JSON.stringify(failure).includes('store path secret'), false)
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

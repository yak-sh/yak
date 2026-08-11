// The account clients trust one server state, retain ceremonies only in
// memory, and ignore replies from an action the user already superseded.
import { assertEquals, assertStringIncludes } from '@std/assert'
import {
  account,
  type AccountDoor,
  accountDoor,
  accountStatus,
  loginStart,
} from './account_client.ts'
import type { AccountStatus } from './accounts.ts'

let signedOut = (): AccountStatus => ({
  provider: 'codex',
  state: 'signed_out',
  ready: false,
  auth: null,
})
let pending = (login: 'browser' | 'device'): AccountStatus => ({
  provider: 'codex',
  state: 'pending',
  ready: false,
  auth: null,
  login,
})
let ready = (): AccountStatus => ({
  provider: 'codex',
  state: 'ready',
  ready: true,
  auth: 'chatgpt',
  plan: 'plus',
})

let fixture = () => {
  let status = signedOut()
  let calls: string[] = []
  let door: AccountDoor = {
    status: () => {
      calls.push('status')
      return Promise.resolve(status)
    },
    login: (method) => {
      calls.push(`login:${method}`)
      status = pending(method)
      return Promise.resolve(
        method == 'browser'
          ? {
            method,
            authorizationUrl: 'https://auth.example/login?state=opaque',
          }
          : {
            method,
            verificationUrl: 'https://auth.example/device',
            userCode: 'ABCD-1234',
          },
      )
    },
    complete: (callback) => {
      calls.push(`complete:${callback}`)
      status = ready()
      return Promise.resolve(status)
    },
    cancel: () => {
      calls.push('cancel')
      status = signedOut()
      return Promise.resolve(status)
    },
    logout: () => {
      calls.push('logout')
      status = signedOut()
      return Promise.resolve(status)
    },
  }
  let ticks: (() => void)[] = []
  let control = account(
    door,
    (run) => {
      ticks.push(run)
      return ticks.length as unknown as ReturnType<typeof setTimeout>
    },
    () => {},
  )
  return {
    control,
    calls,
    settle: (next: AccountStatus) => status = next,
    tick: async () => {
      ticks.shift()?.()
      await Promise.resolve()
    },
  }
}

Deno.test('account login follows the server from ceremony to readiness', async () => {
  let run = fixture()
  await run.control.read()
  assertEquals(run.control.view.value.status?.state, 'signed_out')

  assertEquals(await run.control.login('browser'), {
    method: 'browser',
    authorizationUrl: 'https://auth.example/login?state=opaque',
  })
  assertEquals(run.control.view.value, {
    status: pending('browser'),
    ceremony: {
      method: 'browser',
      authorizationUrl: 'https://auth.example/login?state=opaque',
    },
  })

  run.settle(ready())
  await run.tick()
  assertEquals(run.control.view.value, { status: ready() })
  assertEquals(run.calls, ['status', 'login:browser', 'status', 'status'])
})

Deno.test('account device ceremony cancels without retaining its code', async () => {
  let run = fixture()
  await run.control.login('device')
  assertEquals(run.control.view.value.ceremony, {
    method: 'device',
    verificationUrl: 'https://auth.example/device',
    userCode: 'ABCD-1234',
  })
  await run.control.cancel()
  assertEquals(run.control.view.value, { status: signedOut() })
  assertEquals(run.calls, ['login:device', 'status', 'cancel'])
})

Deno.test('account mutations serialize a deferred login', async () => {
  let started = Promise.withResolvers<
    Awaited<ReturnType<AccountDoor['login']>>
  >()
  let calls: string[] = []
  let door: AccountDoor = {
    status: () => Promise.resolve(pending('browser')),
    login: () => {
      calls.push('login')
      return started.promise
    },
    cancel: () => {
      calls.push('cancel')
      return Promise.resolve(signedOut())
    },
    complete: () => Promise.resolve(ready()),
    logout: () => Promise.resolve(signedOut()),
  }
  let control = account(door)
  let login = control.login('browser')
  await control.login('device')
  await control.cancel()
  started.resolve({
    method: 'browser',
    authorizationUrl: 'https://auth.example/late',
  })
  await login
  assertEquals(calls, ['login'])
  assertEquals(control.view.value.status?.state, 'pending')
  await control.cancel()
  assertEquals(calls, ['login', 'cancel'])
  assertEquals(control.view.value, { status: signedOut() })
})

Deno.test('dismissing an in-flight login cancels after the server owns it', async () => {
  let started = Promise.withResolvers<
    Awaited<ReturnType<AccountDoor['login']>>
  >()
  let calls: string[] = []
  let control = account({
    status: () => {
      calls.push('status')
      return Promise.resolve(pending('browser'))
    },
    login: () => {
      calls.push('login')
      return started.promise
    },
    complete: () => Promise.resolve(ready()),
    cancel: () => {
      calls.push('cancel')
      return Promise.resolve(signedOut())
    },
    logout: () => Promise.resolve(signedOut()),
  })
  let login = control.login('browser')
  let dismiss = control.dismiss()
  assertEquals(calls, ['login'])
  started.resolve({
    method: 'browser',
    authorizationUrl: 'https://auth.example/login',
  })
  await Promise.all([login, dismiss])
  assertEquals(calls, ['login', 'cancel'])
  assertEquals(control.view.value, { status: signedOut() })
})

Deno.test('a ceremony keeps polling and cancellable across a failed read', async () => {
  let reads = 0
  let cancelled = false
  let ticks: (() => void)[] = []
  let control = account(
    {
      status: () => {
        reads++
        if (reads == 1) return Promise.reject(Error('offline'))
        return Promise.resolve(reads == 2 ? pending('device') : ready())
      },
      login: () =>
        Promise.resolve({
          method: 'device',
          verificationUrl: 'https://auth.example/device',
          userCode: 'ABCD-1234',
        }),
      complete: () => Promise.resolve(ready()),
      cancel: () => {
        cancelled = true
        return Promise.resolve(signedOut())
      },
      logout: () => Promise.resolve(signedOut()),
    },
    (run) => {
      ticks.push(run)
      return ticks.length as unknown as ReturnType<typeof setTimeout>
    },
    () => {},
  )

  await control.login('device')
  assertEquals(control.view.value.status, pending('device'))
  assertEquals(control.view.value.error, {
    code: 'account_request_failed',
    message:
      'The Codex account request stopped before Tasks received a response. Retry the request.',
  })
  await control.cancel()
  assertEquals(cancelled, true)
  assertEquals(control.view.value, { status: signedOut() })

  cancelled = false
  reads = 0
  ticks = []
  await control.login('device')
  ticks.shift()?.()
  await Promise.resolve()
  assertEquals(control.view.value.status, pending('device'))
  assertEquals(control.view.value.error?.code, 'account_request_failed')
  ticks.shift()?.()
  await Promise.resolve()
  assertEquals(control.view.value, { status: ready() })
  assertEquals(cancelled, false)
})

Deno.test('server callback errors replace stale polling failures', async () => {
  let reads = 0
  let ticks: (() => void)[] = []
  let server = {
    ...pending('browser'),
    error: {
      code: 'callback_rejected',
      message: 'Codex rejected the callback with HTTP 401.',
    },
  } satisfies AccountStatus
  let control = account(
    {
      status: () =>
        ++reads == 1
          ? Promise.reject(Error('offline'))
          : Promise.resolve(server),
      login: () =>
        Promise.resolve({
          method: 'browser',
          authorizationUrl: 'https://auth.example/login',
        }),
      complete: () => Promise.resolve(ready()),
      cancel: () => Promise.resolve(signedOut()),
      logout: () => Promise.resolve(signedOut()),
    },
    (run) => {
      ticks.push(run)
      return ticks.length as unknown as ReturnType<typeof setTimeout>
    },
    () => {},
  )
  await control.login('browser')
  assertEquals(control.view.value.error?.code, 'account_request_failed')
  ticks.shift()?.()
  await Promise.resolve()
  assertEquals(control.view.value.error, undefined)
  assertEquals(control.view.value.status?.error?.code, 'callback_rejected')
  control.close()
})

Deno.test('account completion retains its ceremony only on failure', async () => {
  let run = fixture()
  await run.control.login('browser')
  await run.control.complete('http://localhost/callback?code=x&state=y')
  assertEquals(run.control.view.value, { status: ready() })
  assertEquals(run.calls, [
    'login:browser',
    'status',
    'complete:http://localhost/callback?code=x&state=y',
  ])

  let status = pending('browser')
  let control = account({
    status: () => Promise.resolve(status),
    login: () =>
      Promise.resolve({
        method: 'browser',
        authorizationUrl: 'https://auth.example/login',
      }),
    complete: () => Promise.reject(Error('relay failed')),
    cancel: () => Promise.resolve(signedOut()),
    logout: () => Promise.resolve(signedOut()),
  })
  await control.login('browser')
  await control.complete('http://localhost/callback?code=x&state=y')
  assertEquals(control.view.value.ceremony?.method, 'browser')
  assertEquals(control.view.value.error?.code, 'account_request_failed')
  control.close()
})

Deno.test('callback retry clears the prior error while progress is visible', async () => {
  let done = Promise.withResolvers<AccountStatus>()
  let status: AccountStatus = {
    ...pending('browser'),
    error: {
      code: 'callback_unreachable',
      message: 'Tasks could not reach the callback listener.',
    },
  }
  let control = account({
    status: () => Promise.resolve(status),
    login: () => Promise.resolve(status),
    complete: () => done.promise,
    cancel: () => Promise.resolve(signedOut()),
    logout: () => Promise.resolve(signedOut()),
  })
  control.view.value = {
    status,
    ceremony: {
      method: 'browser',
      authorizationUrl: 'https://auth.example/login',
    },
    error: {
      code: 'account_service_unreachable',
      message: 'The last poll failed.',
    },
  }
  let completing = control.complete(
    'http://localhost/callback?code=x&state=y',
  )
  assertEquals(control.view.value.busy, 'complete')
  assertEquals(control.view.value.error, undefined)
  assertEquals(control.view.value.status?.error, undefined)
  done.resolve(ready())
  await completing
  assertEquals(control.view.value, { status: ready() })
  control.close()
})

Deno.test('account client rejects unsafe ceremony and inconsistent status', () => {
  for (
    let value of [
      { method: 'browser', authorizationUrl: 'javascript:alert(1)' },
      {
        method: 'device',
        verificationUrl: 'https://auth.example',
        userCode: '\x1b]52;bad',
      },
    ]
  ) {
    try {
      loginStart(value)
      throw Error('accepted')
    } catch (error) {
      assertStringIncludes((error as Error).message, 'unsafe')
    }
  }
  try {
    accountStatus({
      provider: 'codex',
      state: 'ready',
      ready: false,
      auth: 'chatgpt',
    })
    throw Error('accepted')
  } catch (error) {
    assertStringIncludes((error as Error).message, 'invalid status')
  }
})

Deno.test('account HTTP door sends only short-lived ceremony inputs', async () => {
  let requests: { url: string; init?: RequestInit }[] = []
  let run = (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init })
    let body = init?.body ? JSON.parse(String(init.body)) : null
    let value = body?.method
      ? { method: body.method, authorizationUrl: 'https://auth.example' }
      : signedOut()
    return Promise.resolve(Response.json(value))
  }
  let door = accountDoor(run, () => 'http://tasks.test')
  await door.status()
  await door.login('browser')
  await door.complete('http://localhost/callback?code=x&state=y')
  assertEquals(requests.map((x) => [x.url, x.init?.body]), [
    ['http://tasks.test/accounts/codex', undefined],
    [
      'http://tasks.test/accounts/codex/login',
      JSON.stringify({ method: 'browser' }),
    ],
    [
      'http://tasks.test/accounts/codex/complete',
      JSON.stringify({ callback: 'http://localhost/callback?code=x&state=y' }),
    ],
  ])
})

Deno.test('account HTTP errors keep their stable identity', async () => {
  let door = accountDoor(
    () =>
      Promise.resolve(Response.json({
        error: {
          code: 'device_login_disabled',
          message: 'Enable device login in ChatGPT Security settings.',
        },
      }, { status: 502 })),
    () => 'http://tasks.test',
  )
  try {
    await door.login('device')
    throw Error('accepted')
  } catch (error) {
    let value = error as Error & {
      account?: { code: string; message: string }
    }
    assertEquals(value.account, {
      code: 'device_login_disabled',
      message: 'Enable device login in ChatGPT Security settings.',
    })
  }
})

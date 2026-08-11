// Provider accounts: one redacted Codex state machine for HTTP clients and
// one credential source for the Responses edge. OAuth remains app-server's;
// the browser sees ceremony data, never the credential or its account id.
import {
  type AuthStore,
  type Issuer,
  type Rpc,
  type Stored,
} from './codex_auth.ts'
import { type Credential, type CredentialSource } from './responses.ts'

export type AccountError = {
  code: string
  message: string
}

export type Limit = {
  used: number
  resets_at?: number
  window_minutes?: number
}

export type AccountStatus = {
  provider: 'codex'
  state: 'signed_out' | 'pending' | 'ready' | 'error' | 'unavailable'
  ready: boolean
  auth: 'chatgpt' | 'apiKey' | null
  email?: string
  plan?: string
  login?: 'browser' | 'device'
  limits?: { primary?: Limit; secondary?: Limit; reached?: string }
  error?: AccountError
}

export type LoginInput =
  | { method: 'browser' }
  | { method: 'device' }
  | { method: 'apiKey'; apiKey: string }

export type LoginStart =
  | { method: 'browser'; authorizationUrl: string }
  | { method: 'device'; verificationUrl: string; userCode: string }
  | AccountStatus

export type AccountService = {
  status: () => Promise<AccountStatus>
  login: (input: LoginInput) => Promise<LoginStart>
  complete: (callback: string) => Promise<AccountStatus>
  cancel: () => Promise<AccountStatus>
  logout: () => Promise<AccountStatus>
  refresh: () => Promise<AccountStatus>
  credentials: CredentialSource
  close: () => Promise<void>
}

type Fault = Error & { code: string; status: number }

let faults = {
  unavailable: ['unavailable', 'Codex account service is unavailable.', 503],
  signedOut: ['signed_out', 'Codex is not signed in.', 401],
  pending: ['login_pending', 'A Codex login is already pending.', 409],
  idle: ['no_login', 'No Codex login is pending.', 409],
  invalid: ['invalid_request', 'Invalid Codex account request.', 400],
  browser: ['no_browser_login', 'No browser login is pending.', 409],
  callback: ['invalid_callback', 'Invalid Codex login callback.', 400],
  relay: ['callback_failed', 'Codex login callback failed.', 502],
  login: ['login_failed', 'Codex login failed.', 502],
  refresh: ['refresh_failed', 'Codex account refresh failed.', 502],
} as const

let fault = (value: readonly [string, string, number]) =>
  Object.assign(new Error(value[1]), { code: value[0], status: value[2] })

let isFault = (value: unknown): value is Fault =>
  value instanceof Error &&
  typeof (value as Partial<Fault>).code == 'string' &&
  typeof (value as Partial<Fault>).status == 'number'

let record = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)

let signedOut = (): AccountStatus => ({
  provider: 'codex',
  state: 'signed_out',
  ready: false,
  auth: null,
})

let unavailable = (): AccountStatus => ({
  provider: 'codex',
  state: 'unavailable',
  ready: false,
  auth: null,
  error: { code: faults.unavailable[0], message: faults.unavailable[1] },
})

let failed = (
  value: readonly [string, string, number] = faults.login,
): AccountStatus => ({
  provider: 'codex',
  state: 'error',
  ready: false,
  auth: null,
  error: { code: value[0], message: value[1] },
})

let number = (value: unknown) =>
  typeof value == 'number' && Number.isFinite(value) ? value : undefined

let limit = (value: unknown): Limit | undefined => {
  if (!record(value)) return
  let used = number(value.usedPercent)
  if (used == null) return
  let resets = number(value.resetsAt)
  let window = number(value.windowDurationMins)
  return {
    used,
    ...(resets == null ? {} : { resets_at: resets }),
    ...(window == null ? {} : { window_minutes: window }),
  }
}

let limits = (value: unknown): AccountStatus['limits'] => {
  if (!record(value) || !record(value.rateLimits)) return
  let raw = value.rateLimits
  let primary = limit(raw.primary)
  let secondary = limit(raw.secondary)
  let reached = typeof raw.rateLimitReachedType == 'string'
    ? raw.rateLimitReachedType.slice(0, 64)
    : undefined
  if (!primary && !secondary && !reached) return
  return {
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    ...(reached ? { reached } : {}),
  }
}

let publicAccount = async (rpc: Rpc): Promise<AccountStatus> => {
  let result = await rpc.call('account/read', { refreshToken: false })
  if (!record(result.account)) return signedOut()
  let value = result.account
  let auth = value.type == 'chatgpt'
    ? 'chatgpt' as const
    : value.type == 'apiKey'
    ? 'apiKey' as const
    : null
  if (!auth) throw fault(faults.unavailable)
  let rate: AccountStatus['limits']
  if (auth == 'chatgpt') {
    try {
      rate = limits(await rpc.call('account/rateLimits/read'))
    } catch { /* readiness survives a rate-limit read */ }
  }
  return {
    provider: 'codex',
    state: 'ready',
    ready: true,
    auth,
    ...(typeof value.email == 'string' ? { email: value.email } : {}),
    ...(typeof value.planType == 'string' ? { plan: value.planType } : {}),
    ...(rate ? { limits: rate } : {}),
  }
}

let decode = (part: string) => {
  let value = part.replaceAll('-', '+').replaceAll('_', '/')
  value += '='.repeat((4 - value.length % 4) % 4)
  return atob(value)
}

let accountId = (token: string) => {
  try {
    let payload: unknown = JSON.parse(decode(token.split('.')[1] ?? ''))
    if (!record(payload)) return
    let auth = payload['https://api.openai.com/auth']
    if (!record(auth)) return
    let id = auth.chatgpt_account_id
    return typeof id == 'string' && id ? id : undefined
  } catch {
    return
  }
}

let credential = async (
  rpc: Rpc,
  status: AccountStatus,
  refresh: boolean,
): Promise<Credential> => {
  if (!status.ready || !status.auth) throw fault(faults.signedOut)
  // Stable account RPCs intentionally redact the bearer. This current,
  // generated app-server compatibility RPC is isolated to the in-memory
  // provider edge; if Codex removes it, the CLI fallback remains available.
  let result = await rpc.call('getAuthStatus', {
    includeToken: true,
    refreshToken: refresh,
  })
  let token = result.authToken
  if (typeof token != 'string' || !token) throw fault(faults.signedOut)
  if (status.auth == 'apiKey') {
    return {
      token,
      base: 'https://api.openai.com/v1',
    }
  }
  let account = accountId(token)
  if (!account) throw fault(faults.unavailable)
  return {
    token,
    account,
    base: 'https://chatgpt.com/backend-api/codex',
  }
}

let safeUrl = (value: unknown) => {
  if (typeof value != 'string' || value.length > 4096) {
    throw fault(faults.login)
  }
  try {
    let url = new URL(value)
    if (url.protocol != 'https:' || url.username || url.password) throw Error()
    return url.href
  } catch {
    throw fault(faults.login)
  }
}

let safeCode = (value: unknown) => {
  if (typeof value != 'string' || !/^[A-Za-z0-9-]{4,32}$/.test(value)) {
    throw fault(faults.login)
  }
  return value
}

type Pending = {
  id: string
  method: 'browser' | 'device'
  rpc: Rpc
  stored: Stored
  before: AccountStatus
  redirect?: { origin: string; path: string; state: string }
  cancelled: boolean
  done: Promise<void>
}

type Relay = (
  input: string | URL,
  init: RequestInit,
) => Promise<Response>

let loopback = (host: string) =>
  host == 'localhost' || host == '127.0.0.1' || host == '[::1]'

let browser = (value: unknown) => {
  let authorizationUrl = safeUrl(value)
  let auth = new URL(authorizationUrl)
  let redirects = auth.searchParams.getAll('redirect_uri')
  let states = auth.searchParams.getAll('state')
  if (
    redirects.length != 1 || states.length != 1 || !states[0] ||
    states[0].length > 4096
  ) throw fault(faults.login)
  try {
    let redirect = new URL(redirects[0])
    if (
      redirect.protocol != 'http:' || !loopback(redirect.hostname) ||
      redirect.username || redirect.password || redirect.search || redirect.hash
    ) throw Error()
    return {
      authorizationUrl,
      redirect: {
        origin: redirect.origin,
        path: redirect.pathname,
        state: states[0],
      },
    }
  } catch {
    throw fault(faults.login)
  }
}

let callback = (
  value: unknown,
  redirect: NonNullable<Pending['redirect']>,
) => {
  if (typeof value != 'string' || !value || value.length > 4096) {
    throw fault(faults.callback)
  }
  try {
    let url = new URL(value)
    let code = url.searchParams.getAll('code')
    let state = url.searchParams.getAll('state')
    if (
      url.protocol != 'http:' || url.username || url.password || url.hash ||
      url.origin != redirect.origin || url.pathname != redirect.path ||
      code.length != 1 || !code[0] || state.length != 1 ||
      state[0] != redirect.state || [...url.searchParams.keys()].length != 2
    ) throw Error()
    let target = new URL(redirect.path, redirect.origin)
    target.searchParams.set('code', code[0])
    target.searchParams.set('state', state[0])
    return target
  } catch {
    throw fault(faults.callback)
  }
}

export let accountService = (
  store: AuthStore,
  issuer: Issuer,
  relay: Relay = fetch,
): AccountService => {
  let cache: AccountStatus | undefined
  let current: Credential | undefined
  let pending: Pending | undefined
  let reading: Promise<AccountStatus> | undefined
  let loading: Promise<Credential> | undefined
  let refreshing: Promise<AccountStatus> | undefined

  let transact = async <T>(
    work: (rpc: Rpc) => Promise<T>,
    commit = false,
  ) => {
    let stored: Stored | undefined
    let rpc: Rpc | undefined
    try {
      stored = await store.begin()
      rpc = await issuer.open(stored.home)
      let out = await work(rpc)
      if (commit) await stored.commit()
      return out
    } finally {
      await rpc?.close().catch(() => {})
      await stored?.close().catch(() => {})
    }
  }

  let read = async () => {
    try {
      let status = await transact(publicAccount)
      cache = status
      return status
    } catch {
      cache = unavailable()
      return cache
    }
  }

  let status = () => {
    if (pending) {
      return Promise.resolve<AccountStatus>({
        provider: 'codex',
        state: 'pending',
        ready: false,
        auth: pending.before.auth,
        login: pending.method,
      })
    }
    if (cache) return Promise.resolve(cache)
    reading ??= read().finally(() => reading = undefined)
    return reading
  }

  let load = async (refresh: boolean) => {
    try {
      let out = await transact(async (rpc) => {
        let status = await publicAccount(rpc)
        return { status, credential: await credential(rpc, status, refresh) }
      }, refresh)
      cache = out.status
      current = out.credential
      return out.credential
    } catch (error) {
      current = undefined
      if (isFault(error)) {
        cache = error.code == faults.signedOut[0]
          ? signedOut()
          : error.code == faults.unavailable[0]
          ? unavailable()
          : {
            provider: 'codex',
            state: 'error',
            ready: false,
            auth: null,
            error: { code: error.code, message: error.message },
          }
        throw error
      }
      let next = refresh ? faults.refresh : faults.unavailable
      cache = refresh ? failed(next) : unavailable()
      throw fault(next)
    }
  }

  let get = () => {
    if (current) return Promise.resolve(current)
    loading ??= load(false).finally(() => loading = undefined)
    return loading
  }

  let refreshed = () => {
    if (pending) return Promise.reject(fault(faults.pending))
    refreshing ??= load(true).then(() => cache!).finally(() => {
      refreshing = undefined
    })
    return refreshing
  }

  let finish = async (mine: Pending) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // Codex announces completion before reloading its account cache. The
      // following update is the barrier that makes account/read current.
      let updated = mine.rpc.wait('account/updated').catch(() => undefined)
      let note = await mine.rpc.wait('account/login/completed')
      if (pending != mine) return
      if (mine.cancelled) {
        cache = mine.before
        return
      }
      if (note.loginId != mine.id || note.success !== true) {
        cache = failed()
        return
      }
      let account = await Promise.race([
        updated,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), 30_000)
        }),
      ])
      if (account?.authMode != 'chatgpt') {
        cache = failed()
        return
      }
      let next = await publicAccount(mine.rpc)
      if (!next.ready) {
        cache = failed()
        return
      }
      await mine.stored.commit()
      current = undefined
      cache = next
    } catch {
      if (pending == mine && !mine.cancelled) cache = failed()
    } finally {
      clearTimeout(timer)
      if (pending == mine) pending = undefined
      await mine.rpc.close().catch(() => {})
      await mine.stored.close().catch(() => {})
    }
  }

  let login = async (input: LoginInput): Promise<LoginStart> => {
    if (pending) throw fault(faults.pending)
    if (
      input.method == 'apiKey' &&
      (typeof input.apiKey != 'string' || !input.apiKey.trim() ||
        input.apiKey.length > 4096)
    ) throw fault(faults.invalid)
    let before = await status()
    let stored: Stored | undefined
    let rpc: Rpc | undefined
    try {
      stored = await store.begin()
      rpc = await issuer.open(stored.home)
      if (input.method == 'apiKey') {
        await rpc.call('account/login/start', {
          type: 'apiKey',
          apiKey: input.apiKey,
        })
        let next = await publicAccount(rpc)
        if (!next.ready || next.auth != 'apiKey') throw fault(faults.login)
        await stored.commit()
        current = undefined
        cache = next
        return next
      }
      let result = await rpc.call(
        'account/login/start',
        input.method == 'device' ? { type: 'chatgptDeviceCode' } : {
          type: 'chatgpt',
          useHostedLoginSuccessPage: true,
          appBrand: 'chatgpt',
        },
      )
      let id = result.loginId
      if (typeof id != 'string' || !id) throw fault(faults.login)
      let browserLogin = input.method == 'browser'
        ? browser(result.authUrl)
        : undefined
      let ceremony: LoginStart = browserLogin
        ? { method: 'browser', authorizationUrl: browserLogin.authorizationUrl }
        : {
          method: 'device',
          verificationUrl: safeUrl(result.verificationUrl),
          userCode: safeCode(result.userCode),
        }
      let mine: Pending = {
        id,
        method: input.method,
        rpc,
        stored,
        before,
        ...(browserLogin ? { redirect: browserLogin.redirect } : {}),
        cancelled: false,
        done: Promise.resolve(),
      }
      pending = mine
      mine.done = finish(mine)
      return ceremony
    } catch (error) {
      await rpc?.close().catch(() => {})
      await stored?.close().catch(() => {})
      if (isFault(error)) throw error
      throw fault(faults.login)
    } finally {
      if (input.method == 'apiKey') {
        await rpc?.close().catch(() => {})
        await stored?.close().catch(() => {})
      }
    }
  }

  let complete = async (value: string) => {
    let mine = pending
    if (!mine || mine.method != 'browser' || !mine.redirect) {
      throw fault(faults.browser)
    }
    let target = callback(value, mine.redirect)
    try {
      let response = await relay(target, { redirect: 'manual' })
      await response.body?.cancel().catch(() => {})
    } catch {
      throw fault(faults.relay)
    }
    await mine.done
    return status()
  }

  let cancel = async () => {
    let mine = pending
    if (!mine) throw fault(faults.idle)
    mine.cancelled = true
    pending = undefined
    cache = mine.before
    try {
      await mine.rpc.call('account/login/cancel', { loginId: mine.id })
    } catch { /* closing the RPC settles the waiter below */ }
    await mine.rpc.close().catch(() => {})
    await mine.done.catch(() => {})
    return cache
  }

  let logout = async () => {
    if (pending) await cancel()
    try {
      await transact(async (rpc) => {
        await rpc.call('account/logout')
      }, true)
      current = undefined
      cache = signedOut()
      return cache
    } catch {
      throw fault(faults.unavailable)
    }
  }

  let close = async () => {
    let mine = pending
    if (!mine) return
    mine.cancelled = true
    pending = undefined
    cache = mine.before
    await mine.rpc.close().catch(() => {})
    await mine.stored.close().catch(() => {})
    await mine.done.catch(() => {})
  }

  return {
    status,
    login,
    complete,
    cancel,
    logout,
    refresh: refreshed,
    credentials: { get, refresh: () => refreshed().then(() => current!) },
    close,
  }
}

let headers = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
}

let json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers })

let body = async (req: Request) => {
  if (
    req.headers.get('content-type')?.split(';')[0].trim() != 'application/json'
  ) {
    throw fault(faults.invalid)
  }
  if (!req.body) throw fault(faults.invalid)
  let reader = req.body.getReader()
  let decoder = new TextDecoder()
  let text = '', size = 0
  while (true) {
    let part = await reader.read()
    if (part.done) {
      text += decoder.decode()
      break
    }
    size += part.value.length
    if (size > 8192) {
      await reader.cancel().catch(() => {})
      throw fault(faults.invalid)
    }
    text += decoder.decode(part.value, { stream: true })
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw fault(faults.invalid)
  }
  if (!record(value)) throw fault(faults.invalid)
  return value
}

let empty = (value: Record<string, unknown>) => {
  if (Object.keys(value).length) throw fault(faults.invalid)
}

let input = (value: Record<string, unknown>): LoginInput => {
  if (value.method == 'browser' && Object.keys(value).length == 1) {
    return { method: 'browser' }
  }
  if (value.method == 'device' && Object.keys(value).length == 1) {
    return { method: 'device' }
  }
  if (
    value.method == 'apiKey' && typeof value.apiKey == 'string' &&
    Object.keys(value).length == 2
  ) return { method: 'apiKey', apiKey: value.apiKey }
  throw fault(faults.invalid)
}

let callbackInput = (value: Record<string, unknown>) => {
  if (typeof value.callback != 'string' || Object.keys(value).length != 1) {
    throw fault(faults.invalid)
  }
  return value.callback
}

export let accountHttp = async (
  service: AccountService,
  req: Request,
  path = new URL(req.url).pathname,
) => {
  try {
    if (path == '/accounts/codex' && req.method == 'GET') {
      return json(await service.status())
    }
    let action = path.match(
      /^\/accounts\/codex\/(login|complete|cancel|logout|refresh)$/,
    )
    if (!action) return json({ error: 'not_found' }, 404)
    if (req.method != 'POST') return json({ error: 'method_not_allowed' }, 405)
    let value = await body(req)
    if (action[1] == 'login') return json(await service.login(input(value)))
    if (action[1] == 'complete') {
      return json(await service.complete(callbackInput(value)))
    }
    empty(value)
    if (action[1] == 'cancel') return json(await service.cancel())
    if (action[1] == 'logout') return json(await service.logout())
    return json(await service.refresh())
  } catch (error) {
    let safe = isFault(error) ? error : fault(faults.unavailable)
    return json(
      { error: { code: safe.code, message: safe.message } },
      safe.status,
    )
  }
}

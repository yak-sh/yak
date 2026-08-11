// The client half of provider accounts: one redacted view of the server's
// state, plus the short-lived browser/device ceremony. The graph, provider
// vocabulary and browser storage never become another account authority.
import { signal } from '@preact/signals'
import type { AccountError, AccountStatus, LoginStart } from './accounts.ts'
import { base } from './live.ts'

export type LoginMethod = 'browser' | 'device'
export type Ceremony = Exclude<LoginStart, AccountStatus>

export type AccountDoor = {
  status: () => Promise<AccountStatus>
  login: (method: LoginMethod) => Promise<LoginStart>
  complete: (callback: string) => Promise<AccountStatus>
  cancel: () => Promise<AccountStatus>
  logout: () => Promise<AccountStatus>
}

export type AccountView = {
  status?: AccountStatus
  ceremony?: Ceremony
  busy?: 'read' | 'login' | 'complete' | 'cancel' | 'logout'
  error?: AccountError
}

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>
type Timer = ReturnType<typeof setTimeout>
type Later = (run: () => void, ms: number) => Timer
type Clear = (timer: Timer) => void

let record = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)

let text = (value: unknown, max: number) =>
  typeof value == 'string' && value.length <= max ? value : undefined

let url = (value: unknown) => {
  let raw = text(value, 4096)
  if (!raw) throw Error('Codex login returned an unsafe URL.')
  try {
    let parsed = new URL(raw)
    if (
      parsed.protocol != 'https:' || parsed.username || parsed.password
    ) throw Error()
    return parsed.href
  } catch {
    throw Error('Codex login returned an unsafe URL.')
  }
}

let accountError = (value: unknown) => {
  if (!record(value)) return
  let code = text(value.code, 64)
  let message = text(value.message, 500)
  return code && message ? { code, message } : undefined
}

let states = new Set([
  'signed_out',
  'pending',
  'ready',
  'error',
  'unavailable',
])
let auths = new Set(['chatgpt', 'apiKey'])

export let accountStatus = (value: unknown): AccountStatus => {
  if (
    !record(value) || value.provider != 'codex' ||
    typeof value.state != 'string' || !states.has(value.state) ||
    typeof value.ready != 'boolean' ||
    value.ready != (value.state == 'ready') ||
    !(value.auth == null ||
      (typeof value.auth == 'string' && auths.has(value.auth)))
  ) {
    throw Error('Codex account returned an invalid status.')
  }
  let state = value.state as AccountStatus['state']
  let auth = value.auth as AccountStatus['auth']
  if (state == 'ready' && !auth) {
    throw Error('Codex account returned an invalid status.')
  }
  let email = text(value.email, 320)
  let plan = text(value.plan, 64)
  let login: AccountStatus['login'] = value.login == 'browser'
    ? 'browser'
    : value.login == 'device'
    ? 'device'
    : undefined
  let error = accountError(value.error)
  return {
    provider: 'codex',
    state,
    ready: value.ready,
    auth,
    ...(email ? { email } : {}),
    ...(plan ? { plan } : {}),
    ...(login ? { login } : {}),
    ...(error ? { error } : {}),
  }
}

export let loginStart = (value: unknown): LoginStart => {
  if (record(value) && value.method == 'browser') {
    return { method: 'browser', authorizationUrl: url(value.authorizationUrl) }
  }
  if (record(value) && value.method == 'device') {
    let code = text(value.userCode, 32)
    if (!code || !/^[A-Za-z0-9-]{4,32}$/.test(code)) {
      throw Error('Codex login returned an unsafe code.')
    }
    return {
      method: 'device',
      verificationUrl: url(value.verificationUrl),
      userCode: code,
    }
  }
  return accountStatus(value)
}

type RequestError = Error & { account: AccountError }

let requestError = (account: AccountError): RequestError =>
  Object.assign(new Error(account.message), { account })

let isRequestError = (value: unknown): value is RequestError =>
  value instanceof Error &&
  accountError((value as Partial<RequestError>).account) != null

let requestProblem = (code: string, message: string) =>
  requestError({ code, message })

let problem = (value: unknown) =>
  accountError(record(value) ? value.error : undefined) ?? {
    code: 'account_request_failed',
    message: 'The Codex account request failed without an explanation.',
  }

export let accountDoor = (
  run: Fetch = fetch,
  root: () => string = base,
): AccountDoor => {
  let ask = async (path = '', body?: unknown) => {
    let response: Response
    try {
      response = await run(
        `${root()}/accounts/codex${path}`,
        body == null ? undefined : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
    } catch {
      throw requestProblem(
        'account_service_unreachable',
        'Tasks could not reach the Codex account service. Check the daemon connection, then retry.',
      )
    }
    let value: unknown
    try {
      value = await response.json()
    } catch {
      throw requestProblem(
        'account_response_invalid',
        'The Codex account service returned an unreadable response. Retry after checking the tasksd logs.',
      )
    }
    if (!response.ok) throw requestError(problem(value))
    return value
  }
  let decode = async <T>(
    work: () => Promise<unknown>,
    parse: (v: unknown) => T,
  ) => {
    let value = await work()
    try {
      return parse(value)
    } catch (error) {
      if (isRequestError(error)) throw error
      throw requestProblem(
        'account_response_invalid',
        'The Codex account service returned an invalid account state. Retry after checking the tasksd version.',
      )
    }
  }
  let action = (name: string) => ask(`/${name}`, {})
  return {
    status: () => decode(() => ask(), accountStatus),
    login: (method) => decode(() => ask('/login', { method }), loginStart),
    complete: (callback) =>
      decode(() => ask('/complete', { callback }), accountStatus),
    cancel: () => decode(() => action('cancel'), accountStatus),
    logout: () => decode(() => action('logout'), accountStatus),
  }
}

let failure = (error: unknown): AccountError =>
  isRequestError(error) ? error.account : {
    code: 'account_request_failed',
    message:
      'The Codex account request stopped before Tasks received a response. Retry the request.',
  }

let pending = (
  method: LoginMethod,
  before?: AccountStatus,
): AccountStatus => ({
  provider: 'codex',
  state: 'pending',
  ready: false,
  auth: before?.auth ?? null,
  login: method,
})

// A controller remembers only what the server last SAID and the ceremony the
// current client must show. Its generation fences late reads after cancel or
// logout. Pending failures stay named and visible until the user retries or
// the server reports a terminal result; polling must never erase the story.
export let account = (
  door: AccountDoor,
  later: Later = setTimeout,
  clear: Clear = clearTimeout,
  delay = 1000,
) => {
  let view = signal<AccountView>({})
  let timer: Timer | undefined
  let generation = 0
  let owned = false
  let serverPending = false
  let starting: Promise<LoginStart> | undefined
  let locked = () => view.peek().busy != null

  let stop = () => {
    if (timer != null) clear(timer)
    timer = undefined
  }
  let poll = (mine: number) => {
    stop()
    if (view.peek().status?.state != 'pending') return
    timer = later(() => {
      timer = undefined
      read(mine, false)
    }, delay)
  }
  let land = (status: AccountStatus, mine: number, keepError = false) => {
    if (mine != generation) return
    if (status.state != 'pending') {
      owned = false
      serverPending = false
    }
    let before = view.peek()
    view.value = {
      status,
      ...(status.state == 'pending' && before.ceremony
        ? { ceremony: before.ceremony }
        : {}),
      ...(status.state == 'pending' && keepError && before.error &&
          !status.error
        ? { error: before.error }
        : {}),
    }
    poll(mine)
  }
  let fail = (error: unknown, mine: number) => {
    if (mine != generation) return
    view.value = { ...view.peek(), busy: undefined, error: failure(error) }
    poll(mine)
  }
  let read = async (mine = generation, retry = true) => {
    if (mine != generation || locked()) return
    stop()
    let before = view.peek()
    view.value = {
      ...(before.status ? { status: before.status } : {}),
      ...(before.ceremony ? { ceremony: before.ceremony } : {}),
      ...(!retry && before.error ? { error: before.error } : {}),
      busy: 'read',
    }
    try {
      land(await door.status(), mine, !retry)
    } catch (error) {
      fail(error, mine)
    }
  }
  let begin = async (method: LoginMethod) => {
    let mine = ++generation
    stop()
    view.value = {
      status: view.peek().status,
      busy: 'login',
    }
    let request = door.login(method)
    starting = request
    try {
      let start = await request
      if (starting == request) starting = undefined
      serverPending = !('provider' in start)
      if (!serverPending) owned = false
      if (mine != generation) return
      if ('provider' in start) {
        land(start, mine)
        return
      }
      view.value = {
        status: pending(method, view.peek().status),
        ceremony: start,
        busy: 'read',
      }
      land(await door.status(), mine)
      return start
    } catch (error) {
      if (starting == request) starting = undefined
      if (!serverPending) owned = false
      fail(error, mine)
    }
  }
  let login = (method: LoginMethod) => {
    if (locked()) return Promise.resolve()
    owned = true
    return begin(method)
  }
  let act = async (
    busy: 'cancel' | 'logout',
    run: () => Promise<AccountStatus>,
    supersede = false,
  ) => {
    if (locked() && !supersede) return
    let mine = ++generation
    stop()
    view.value = { status: view.peek().status, busy }
    try {
      land(await run(), mine)
    } catch (error) {
      fail(error, mine)
    }
  }
  let complete = async (callback: string) => {
    if (
      locked() || view.peek().status?.state != 'pending' ||
      view.peek().status?.login != 'browser'
    ) return
    let mine = ++generation
    stop()
    let before = view.peek()
    let status = before.status
    if (status?.state == 'pending' && status.error) {
      let { error: _error, ...clean } = status
      status = clean
    }
    view.value = {
      ...(status ? { status } : {}),
      ...(before.ceremony ? { ceremony: before.ceremony } : {}),
      busy: 'complete',
    }
    try {
      land(await door.complete(callback), mine)
    } catch (error) {
      fail(error, mine)
    }
  }
  let dismiss = async () => {
    let before = view.peek()
    if (!owned && !before.ceremony) return
    owned = true
    serverPending ||= before.ceremony != null
    let waiting = starting
    let mine = ++generation
    stop()
    view.value = {
      ...(before.status ? { status: before.status } : {}),
      busy: 'cancel',
    }
    await waiting?.catch(() => {})
    if (!serverPending) {
      owned = false
      if (mine == generation) {
        view.value = before.status ? { status: before.status } : {}
      }
      return
    }
    try {
      land(await door.cancel(), mine)
    } catch (error) {
      fail(error, mine)
    }
  }
  return {
    view,
    read: () => read(),
    login,
    complete,
    dismiss,
    cancel: () =>
      view.peek().status?.state == 'pending'
        ? act('cancel', door.cancel, true)
        : Promise.resolve(),
    logout: () =>
      view.peek().status?.ready
        ? act('logout', door.logout)
        : Promise.resolve(),
    close: () => {
      generation++
      stop()
    },
  }
}

export type AccountControl = ReturnType<typeof account>

export let codexAccount = account(accountDoor())

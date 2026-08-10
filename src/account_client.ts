// The client half of provider accounts: one redacted view of the server's
// state, plus the short-lived browser/device ceremony. The graph, provider
// vocabulary and browser storage never become another account authority.
import { signal } from '@preact/signals'
import type { AccountStatus, LoginStart } from './accounts.ts'
import { base } from './live.ts'

export type LoginMethod = 'browser' | 'device'
export type Ceremony = Exclude<LoginStart, AccountStatus>

export type AccountDoor = {
  status: () => Promise<AccountStatus>
  login: (method: LoginMethod) => Promise<LoginStart>
  cancel: () => Promise<AccountStatus>
  logout: () => Promise<AccountStatus>
}

export type AccountView = {
  status?: AccountStatus
  ceremony?: Ceremony
  busy?: 'read' | 'login' | 'cancel' | 'logout'
  error?: string
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

let problem = (value: unknown) =>
  accountError(record(value) ? value.error : undefined)?.message ??
    'Codex account request failed.'

export let accountDoor = (
  run: Fetch = fetch,
  root: () => string = base,
): AccountDoor => {
  let ask = async (path = '', body?: unknown) => {
    let response = await run(
      `${root()}/accounts/codex${path}`,
      body == null ? undefined : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    let value: unknown
    try {
      value = await response.json()
    } catch {
      throw Error('Codex account returned an invalid response.')
    }
    if (!response.ok) throw Error(problem(value))
    return value
  }
  let action = (name: string) => ask(`/${name}`, {}).then(accountStatus)
  return {
    status: () => ask().then(accountStatus),
    login: (method) => ask('/login', { method }).then(loginStart),
    cancel: () => action('cancel'),
    logout: () => action('logout'),
  }
}

let message = (error: unknown) =>
  error instanceof Error ? error.message : 'Codex account request failed.'

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
// logout; polling exists only while the server itself says pending.
export let account = (
  door: AccountDoor,
  later: Later = setTimeout,
  clear: Clear = clearTimeout,
  delay = 1000,
) => {
  let view = signal<AccountView>({})
  let timer: Timer | undefined
  let generation = 0
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
      read(mine)
    }, delay)
  }
  let land = (status: AccountStatus, mine: number) => {
    if (mine != generation) return
    view.value = {
      status,
      ...(status.state == 'pending' && view.peek().ceremony
        ? { ceremony: view.peek().ceremony }
        : {}),
    }
    poll(mine)
  }
  let fail = (error: unknown, mine: number) => {
    if (mine != generation) return
    view.value = { ...view.peek(), busy: undefined, error: message(error) }
    poll(mine)
  }
  let read = async (mine = generation) => {
    if (mine != generation || locked()) return
    stop()
    view.value = { ...view.peek(), busy: 'read', error: undefined }
    try {
      land(await door.status(), mine)
    } catch (error) {
      fail(error, mine)
    }
  }
  let login = async (method: LoginMethod) => {
    if (locked()) return
    let mine = ++generation
    stop()
    view.value = {
      status: view.peek().status,
      busy: 'login',
    }
    try {
      let start = await door.login(method)
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
      fail(error, mine)
    }
  }
  let act = async (
    busy: 'cancel' | 'logout',
    run: () => Promise<AccountStatus>,
  ) => {
    if (locked()) return
    let mine = ++generation
    stop()
    view.value = { status: view.peek().status, busy }
    try {
      land(await run(), mine)
    } catch (error) {
      fail(error, mine)
    }
  }
  return {
    view,
    read: () => read(),
    login,
    cancel: () =>
      view.peek().status?.state == 'pending'
        ? act('cancel', door.cancel)
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

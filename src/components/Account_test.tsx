// The web account face opens only validated ceremony URLs and paints provider
// messages as inert text.
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { account, type AccountDoor } from '../account_client.ts'
import type { AccountStatus } from '../accounts.ts'
import {
  Account,
  accountKey,
  accountOpen,
  browserLogin,
  dismissAccount,
  finishLogin,
} from './Account.tsx'

let signedOut = (): AccountStatus => ({
  provider: 'codex',
  state: 'signed_out',
  ready: false,
  auth: null,
})

let door = (
  status: AccountStatus,
  start?: AccountDoor['login'],
): AccountDoor => ({
  status: () => Promise.resolve(status),
  login: start ?? (() => Promise.resolve(status)),
  complete: () => Promise.resolve(status),
  cancel: () => Promise.resolve(signedOut()),
  logout: () => Promise.resolve(signedOut()),
})

Deno.test('account dialog keeps provider text inert and device links safe', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let status: AccountStatus = {
    provider: 'codex',
    state: 'pending',
    ready: false,
    auth: null,
    login: 'device',
    error: {
      code: 'provider',
      message: '<img src=x onerror=alert(1)>\x1b]52;clipboard',
    },
  }
  let control = account(door(status))
  control.view.value = {
    status,
    ceremony: {
      method: 'device',
      verificationUrl: 'https://auth.example/device',
      userCode: 'ABCD-1234',
    },
  }
  let root = document.querySelector('main')!
  try {
    accountOpen.value = true
    render(h(Account, { control }), root)
    assertEquals(root.querySelector('img'), null)
    assertStringIncludes(root.textContent, '<img src=x onerror=alert(1)>')
    assertStringIncludes(root.textContent, 'provider —')
    assertEquals(
      root.querySelector('.Account_Url')?.getAttribute('href'),
      'https://auth.example/device',
    )
    assertEquals(root.querySelector('.Account_Code')?.textContent, 'ABCD-1234')
  } finally {
    accountOpen.value = false
    control.close()
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('account progress says what Tasks is asking Codex to do', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let status: AccountStatus = {
    provider: 'codex',
    state: 'pending',
    ready: false,
    auth: null,
    login: 'browser',
  }
  let control = account(door(status))
  let root = document.querySelector('main')!
  let cases = [
    ['login', 'asking Codex to start login…'],
    [
      'complete',
      'delivering the callback and checking the Codex account…',
    ],
    ['cancel', 'asking Codex to cancel login…'],
    ['logout', 'asking Codex to sign out…'],
    ['read', 'checking Codex account status…'],
  ] as const
  try {
    accountOpen.value = true
    for (let [busy, message] of cases) {
      control.view.value = { status, busy }
      render(h(Account, { control }), root)
      assertEquals(root.querySelector('.Account_State')?.textContent, message)
    }
  } finally {
    accountOpen.value = false
    control.close()
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('dismissing the web account cancels only this client ceremony', async () => {
  let status: AccountStatus = {
    provider: 'codex',
    state: 'pending',
    ready: false,
    auth: null,
    login: 'browser',
  }
  let cancels = 0
  let accountDoor = door(status)
  accountDoor.cancel = () => {
    cancels++
    return Promise.resolve(signedOut())
  }
  let owner = account(accountDoor)
  owner.view.value = {
    status,
    ceremony: {
      method: 'browser',
      authorizationUrl: 'https://auth.example/login',
    },
  }
  accountOpen.value = true
  dismissAccount(owner)
  await Promise.resolve()
  assertEquals({ open: accountOpen.value, cancels }, {
    open: false,
    cancels: 1,
  })

  let observer = account(accountDoor)
  observer.view.value = { status }
  accountOpen.value = true
  dismissAccount(observer)
  await Promise.resolve()
  assertEquals({ open: accountOpen.value, cancels }, {
    open: false,
    cancels: 1,
  })
  owner.close()
  observer.close()
})

Deno.test('browser login detaches its pre-opened window before navigation', async () => {
  let status: AccountStatus = {
    provider: 'codex',
    state: 'pending',
    ready: false,
    auth: null,
    login: 'browser',
  }
  let control = account(door(status, () =>
    Promise.resolve({
      method: 'browser',
      authorizationUrl: 'https://auth.example/login?state=opaque',
    })))
  let replaced = '', closed = false
  let popup = {
    opener: {},
    close: () => closed = true,
    location: { replace: (href: string) => replaced = href },
  }
  await browserLogin(control, () => popup as unknown as Window)
  assertEquals(popup.opener, null)
  assertEquals(replaced, 'https://auth.example/login?state=opaque')
  assertEquals(closed, false)
  control.close()
})

Deno.test('browser callback paste clears before it finishes login', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let status: AccountStatus = {
    provider: 'codex',
    state: 'pending',
    ready: false,
    auth: null,
    login: 'browser',
  }
  let callback = 'http://localhost/callback?code=grant&state=opaque'
  let received = ''
  let accountDoor = door(status)
  accountDoor.complete = (value) => {
    received = value
    assertEquals(callback, '')
    return new Promise(() => {})
  }
  let control = account(accountDoor)
  control.view.value = {
    status,
    ceremony: {
      method: 'browser',
      authorizationUrl: 'https://auth.example/login',
    },
  }
  let root = document.querySelector('main')!
  try {
    accountOpen.value = true
    render(h(Account, { control }), root)
    assertEquals(
      root.querySelector('.Account_Input')?.getAttribute('type'),
      'url',
    )
    finishLogin(control, callback, () => callback = '')
    assertEquals(callback, '')
    assertEquals(
      received,
      'http://localhost/callback?code=grant&state=opaque',
    )
  } finally {
    accountOpen.value = false
    control.close()
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('account dialog owns shortcuts but preserves focus and activation', () => {
  let stopped = 0, prevented = 0
  let event = (key: string, matches = false) => ({
    key,
    target: { matches: () => matches },
    stopImmediatePropagation: () => stopped++,
    preventDefault: () => prevented++,
  })
  accountOpen.value = true
  assertEquals(accountKey(event('?')), true)
  assertEquals({ stopped, prevented, open: accountOpen.value }, {
    stopped: 1,
    prevented: 1,
    open: true,
  })
  accountKey(event('Tab'))
  accountKey(event('Enter', true))
  accountKey(event('x', true))
  assertEquals({ stopped, prevented }, { stopped: 4, prevented: 1 })
  accountKey(event('Escape'))
  assertEquals({ stopped, prevented, open: accountOpen.value }, {
    stopped: 5,
    prevented: 2,
    open: false,
  })
})

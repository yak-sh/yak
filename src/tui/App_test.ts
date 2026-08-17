// TUI-only renderers keep the shared scalar language in their visible labels.
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { type Change, type Ent } from '../types.ts'
import { config as liveConfig, mode } from '../live.ts'
import {
  accountCallback,
  configKey,
  configOpen,
  configSel,
  fit,
  help,
  key,
  navigationKey,
  navigationOpen,
  overrides,
  quit,
  spot,
  spots,
  TAccount,
  TConfig,
  TKeys,
  trail,
  TStatus,
} from './App.tsx'
import { TElement } from './dom.ts'
import { ansi, pane } from './paint.ts'
import { account, type AccountDoor } from '../account_client.ts'
import { config, type CredStatus, type SettingRow } from '../config_client.ts'
import type { AccountStatus } from '../accounts.ts'

let eid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
let task = (body?: string): Ent => ({
  eid,
  num: 1,
  kind: 'task',
  doc: { eid, title: 'One', ...(body === undefined ? {} : { body }) },
  task: { eid, status: 'open', priority: 1.5 },
  refs: [],
  kids: [],
})
// Mount the TUI's Full override through Preact — a renderer is a component,
// never a bare call — and read the painted terminal text back. The footer
// stands in for the app's pinned statusbar, which pane() pops off the bottom.
let paint = (e: Ent) => {
  let root = new TElement('root')
  let target = root as unknown as Parameters<typeof render>[1]
  let r = overrides.find((x) => x.view == 'Full' && x.match(e))!
  render(
    h('div', null, h(r.Render, { e }), h('footer', null, 'status')),
    target,
  )
  let out = pane(root).lines.flat().map((p) => p.text).join('\n')
  render(null, target)
  return out
}

Deno.test('the TUI task heading formats priority through its type', () => {
  assertEquals(paint(task('')).includes('P1.5'), true)
})

// A body this client was never shipped is not an empty one: the terminal
// paints the wait too, rather than a task that looks like it has no body.
Deno.test('the TUI paints the wait for a body it does not have', () => {
  let prior = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error('no server')) // pending() asks
  liveConfig.host = '127.0.0.1:0' // and nothing it queues may reach a real one
  try {
    assertEquals(paint(task('')).includes('…'), false)
    assertEquals(paint(task(undefined)).includes('…'), true)
  } finally {
    globalThis.fetch = prior
  }
})

Deno.test('j/k move the pane cursor, keyed by the entity we are in', () => {
  trail.value = []
  assertEquals(spot(), -1) // the board's cursor is over the query, not lines
  key('j')
  assertEquals(spots.value, {})

  trail.value = ['one']
  key('j')
  key('j')
  assertEquals(spot(), 2)
  key('k')
  assertEquals(spot(), 1)

  trail.value = ['one', 'two'] // a pane deeper starts at its own top
  assertEquals(spot(), 0)
  key('k')
  assertEquals(spot(), 0) // and k at the top stays there
  trail.value = ['one']
  assertEquals(spot(), 1) // stepping back returns to the line we left
})

Deno.test('a cursor the content shrank past comes back to the last line', () => {
  trail.value = ['one']
  spots.value = { one: 40 }
  fit(12)
  assertEquals(spot(), 11)
  fit(0)
  assertEquals(spot(), 0)
  trail.value = []
  fit(3) // nothing to fit at the board
  assertEquals(spot(), -1)
})

Deno.test('⇧⏎ builds a multi-line command shown on one row; ⏎ runs it', () => {
  trail.value = []
  mode.value = 'normal'
  key(':')
  assertEquals(mode.value, 'command')
  for (let c of 'task One') key(c)
  key('\n') // ⇧⏎ (input.decode maps the terminal's report to this): a newline
  for (let c of 'the body') key(c)
  assertEquals(mode.value, 'command') // a newline keeps typing, it doesn't submit

  // One painted row: the embedded newline shows as a glyph rather than
  // splitting the pane, and the buffer kept it (a command reads first line as
  // args, the rest as body). The dummy footer stands in for the pinned bar
  // pane() pops off the bottom, so TStatus's own line lands in `lines`.
  let root = new TElement('root')
  let target = root as unknown as Parameters<typeof render>[1]
  render(h('div', null, h(TStatus, null), h('footer', null, 'x')), target)
  let lines = pane(root).lines.map((l) => l.map((s) => s.text).join(''))
    .filter(Boolean)
  render(null, target)
  assertEquals(lines, [':task One⏎the body█'])

  key('\x1b') // discard it here — the test writes nothing to a server
  assertEquals(mode.value, 'normal')
  key(':')
  key('\r') // ⏎ leaves command mode (submits)
  assertEquals(mode.value, 'normal')
})

Deno.test('question mark shows keybindings until they are dismissed', () => {
  help.value = false
  quit.value = false

  key('?')
  assertEquals(help.value, true)
  key('q')
  assertEquals({ help: help.value, quit: quit.value }, {
    help: false,
    quit: false,
  })

  key('?')
  key('\x1b')
  assertEquals(help.value, false)
})

Deno.test('the TUI keybinding card teaches its navigation keys', () => {
  let root = new TElement('root')
  let target = root as unknown as Parameters<typeof render>[1]
  render(h('div', null, h(TKeys, null), h('footer', null, 'status')), target)
  let lines = pane(root).lines.map((line) => line.map((s) => s.text).join(''))
    .filter(Boolean)
  assertEquals(lines.slice(0, 4), [
    'Keybindings',
    '? show or close keybindings',
    'n open or close navigation',
    'j / k browse',
  ])
  render(null, target)
})

let signedOut = (): AccountStatus => ({
  provider: 'codex',
  state: 'signed_out',
  ready: false,
  auth: null,
})

// One catalog setting the panel can paint and edit; overrides tweak one field.
let ollamaSetting = (over: Partial<SettingRow> = {}): SettingRow => ({
  key: 'OLLAMA_BASE_URL',
  label: 'Ollama base URL',
  group: 'ollama',
  type: 'url',
  help: 'Base URL for the Ollama-compatible API.',
  default: 'https://ollama.yak.sh/',
  value: 'https://ollama.yak.sh/',
  source: 'default',
  ...over,
})

let apiKeyCred = (over: Partial<CredStatus> = {}): CredStatus => ({
  key: 'OLLAMA_API_KEY',
  state: 'missing',
  source: null,
  ...over,
})

// A config controller over stubbed doors: settle runs once with an immediate
// clock so a save never schedules a real timer, and every graph write is
// captured instead of broadcast.
let makeConfig = (settings: SettingRow[] = [], creds: CredStatus[] = []) => {
  let writes: Change[] = []
  let control = config(
    { list: () => Promise.resolve(settings) },
    {
      list: () => Promise.resolve(creds),
      save: (key) =>
        Promise.resolve({ key, state: 'configured', source: 'local' }),
      bind: (key) =>
        Promise.resolve({ key, state: 'configured', source: 'op' }),
      reset: (key) => Promise.resolve({ key, state: 'missing', source: null }),
      refresh: (key) =>
        Promise.resolve({ key, state: 'missing', source: null }),
      test: (key) => Promise.resolve({ key, state: 'missing', source: null }),
    },
    (...cs: Change[]) => writes.push(...cs),
    () => 'minted-eid',
    (run) => {
      run()
      return 0 as unknown as ReturnType<typeof setTimeout>
    },
    0,
    1,
  )
  return { control, writes }
}

// A Codex controller that stays put — the config render/edit tests never touch
// its ceremony, they only need it to paint the section.
let quietCodex = () =>
  account({
    status: () => Promise.resolve(signedOut()),
    login: () => Promise.resolve(signedOut()),
    complete: () => Promise.resolve(signedOut()),
    cancel: () => Promise.resolve(signedOut()),
    logout: () => Promise.resolve(signedOut()),
  })

let paintConfig = (
  control: Parameters<typeof TConfig>[0]['control'],
  codex: Parameters<typeof TConfig>[0]['codex'],
) => {
  let root = new TElement('root')
  let target = root as unknown as Parameters<typeof render>[1]
  render(
    h('div', null, h(TConfig, { control, codex }), h('footer', null, 'x')),
    target,
  )
  let lines = pane(root).lines
  let out = {
    text: lines.flat().map((p) => p.text).join('\n'),
    ansi: lines.map(ansi).join('\n'),
  }
  render(null, target)
  return out
}

Deno.test('the config panel paints a setting with its value and source', () => {
  let { control } = makeConfig()
  control.view.value = {
    settings: [
      ollamaSetting({ value: 'https://ollama.example', source: 'environment' }),
    ],
    creds: [],
    rowError: {},
  }
  let codex = quietCodex()
  let { text } = paintConfig(control, codex)
  assertEquals(text.includes('Configuration'), true)
  assertEquals(text.includes('Ollama base URL'), true)
  assertEquals(text.includes('https://ollama.example'), true)
  assertEquals(text.includes('from environment'), true)
  control.close()
  codex.close()
})

Deno.test('the config panel shows a credential state and never paints the secret', () => {
  let { control } = makeConfig()
  control.view.value = { settings: [], creds: [apiKeyCred()], rowError: {} }
  let codex = quietCodex()
  configOpen.value = true
  configSel.value = 0
  let secret = 'sk-super-secret-value'
  configKey('i', control, codex) // enter the secret value
  for (let c of secret) configKey(c, control, codex)
  let { text } = paintConfig(control, codex)
  assertEquals(text.includes('not configured'), true) // state, not a value
  assertEquals(text.includes(secret), false) // the bytes are never painted
  assertEquals(text.includes('•'), true) // masked while typed
  configKey('\x1b', control, codex) // cancel the edit
  configKey('q', control, codex) // close
  control.close()
  codex.close()
})

Deno.test('a config setting save writes a setting change to the row eid', async () => {
  let row = ollamaSetting({
    eid: 'set-eid-1',
    value: undefined,
    source: 'environment',
  })
  let { control, writes } = makeConfig([row])
  control.view.value = { settings: [row], creds: [], rowError: {} }
  let codex = quietCodex()
  configOpen.value = true
  configSel.value = 0
  configKey('i', control, codex) // edit (draft empty, the value is unset)
  for (let c of 'https://ollama.example') configKey(c, control, codex)
  configKey('\r', control, codex) // commit
  await Promise.resolve()
  await Promise.resolve()
  assertEquals(writes.length, 1)
  assertEquals(writes[0].eid, 'set-eid-1') // targets the existing setting eid
  assertEquals(writes[0].name, 'setting')
  assertEquals(writes[0].comp, {
    key: 'OLLAMA_BASE_URL',
    value: 'https://ollama.example',
  })
  configKey('q', control, codex)
  control.close()
  codex.close()
})

Deno.test('the config Codex section is device-first and captures the panel', async () => {
  let calls: string[] = []
  let status = signedOut()
  let door: AccountDoor = {
    status: () => {
      calls.push('read')
      return Promise.resolve(status)
    },
    login: (method) => {
      calls.push(method)
      status = {
        provider: 'codex',
        state: 'pending',
        ready: false,
        auth: null,
        login: method,
      }
      return Promise.resolve(
        method == 'device'
          ? {
            method,
            verificationUrl: 'https://auth.example/device',
            userCode: 'ABCD-1234',
          }
          : { method, authorizationUrl: 'https://auth.example/login' },
      )
    },
    complete: () => Promise.resolve(status),
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
  let codex = account(door)
  let { control } = makeConfig() // no settings/creds → Codex is the only row
  configOpen.value = false
  navigationOpen.value = false
  mode.value = 'normal'
  assertEquals(navigationKey('n', codex, control), true)
  assertEquals(navigationKey('\r', codex, control), true) // opens Configuration
  await Promise.resolve()
  assertEquals(calls, ['read']) // opening reads the Codex account
  assertEquals(configOpen.value, true)
  configKey('l', control, codex)
  configKey('l', control, codex) // a repeated key cannot start a second ceremony
  await Promise.resolve()
  await Promise.resolve()
  assertEquals(calls, ['read', 'device', 'read'])
  configKey('c', control, codex)
  await Promise.resolve()
  assertEquals(calls, ['read', 'device', 'read', 'cancel'])
  codex.view.value = {
    status: {
      provider: 'codex',
      state: 'ready',
      ready: true,
      auth: 'chatgpt',
    },
  }
  configKey('o', control, codex)
  await Promise.resolve()
  assertEquals(calls, ['read', 'device', 'read', 'cancel', 'logout'])

  // The panel owns the keyboard: j moves its own cursor, not the pane's, and q
  // closes the panel rather than quitting.
  trail.value = ['one']
  spots.value = { one: 2 }
  key('j')
  assertEquals(spot(), 2)
  key('q')
  assertEquals({ open: configOpen.value, quit: quit.value }, {
    open: false,
    quit: false,
  })
  control.close()
  codex.close()
  trail.value = []
})

Deno.test('the config Codex paste clears the callback before it submits', async () => {
  let callback = ''
  let browser: AccountStatus = {
    provider: 'codex',
    state: 'pending',
    ready: false,
    auth: null,
    login: 'browser',
  }
  let status = browser
  let codex = account({
    status: () => Promise.resolve(status),
    login: () => Promise.resolve(status),
    complete: (value) => {
      callback = value
      status = {
        provider: 'codex',
        state: 'ready',
        ready: true,
        auth: 'chatgpt',
      }
      return Promise.resolve(status)
    },
    cancel: () => Promise.resolve(signedOut()),
    logout: () => Promise.resolve(signedOut()),
  })
  codex.view.value = { status }
  let { control } = makeConfig() // Codex is the only (and selected) row
  configOpen.value = true
  configSel.value = 0
  accountCallback.value = null
  configKey('p', control, codex)
  let value = 'http://localhost/callback?code=grant&state=opaque'
  for (let char of value) configKey(char, control, codex)
  assertEquals(accountCallback.peek(), value)
  configKey('\r', control, codex)
  assertEquals(accountCallback.value, null)
  assertEquals(callback, value)
  await Promise.resolve()

  codex.view.value = { status: browser }
  configKey('p', control, codex)
  configKey('x', control, codex)
  configKey('\x1b', control, codex)
  assertEquals(accountCallback.value, null)
  assertEquals(configOpen.value, true)
  configOpen.value = false
  control.close()
  codex.close()
})

Deno.test('closing config cancels an owned Codex ceremony, not a mere observer', async () => {
  let status: AccountStatus = {
    provider: 'codex',
    state: 'pending',
    ready: false,
    auth: null,
    login: 'device',
  }
  let cancels = 0
  let door: AccountDoor = {
    status: () => Promise.resolve(status),
    login: () => Promise.resolve(status),
    complete: () => Promise.resolve(status),
    cancel: () => {
      cancels++
      return Promise.resolve(signedOut())
    },
    logout: () => Promise.resolve(signedOut()),
  }
  let owner = account(door)
  owner.view.value = {
    status,
    ceremony: {
      method: 'device',
      verificationUrl: 'https://auth.example/device',
      userCode: 'ABCD-1234',
    },
  }
  let cfg = makeConfig()
  configOpen.value = true
  configKey('q', cfg.control, owner)
  for (let i = 0; i < 5; i++) await Promise.resolve()
  assertEquals(cancels, 1)
  assertEquals(configOpen.value, false)

  let observer = account(door)
  observer.view.value = { status }
  configOpen.value = true
  configKey('q', cfg.control, observer)
  for (let i = 0; i < 5; i++) await Promise.resolve()
  assertEquals(cancels, 1)
  cfg.control.close()
  owner.close()
  observer.close()
})

Deno.test('the TUI account paints ceremony and hostile errors as plain text', () => {
  let root = new TElement('root')
  let target = root as unknown as Parameters<typeof render>[1]
  let message = 'bad\x1b]52;c;clipboard\x07\x9b31m'
  render(
    h(
      'div',
      null,
      h(TAccount, {
        view: {
          status: {
            provider: 'codex',
            state: 'pending',
            ready: false,
            auth: null,
            login: 'device',
            error: { code: 'provider_error', message },
          },
          ceremony: {
            method: 'device',
            verificationUrl: 'https://auth.example/device',
            userCode: 'ABCD-1234',
          },
        },
      }),
      h('footer', null, 'status'),
    ),
    target,
  )
  let lines = pane(root).lines
  let output = lines.map(ansi).join('\n')
  assertEquals(lines.flat().some((part) => part.style.href), false)
  assertEquals(output.includes('\x1b]52'), false)
  assertEquals(output.includes('\x07'), false)
  assertEquals(output.includes('ABCD-1234'), true)
  assertEquals(output.includes('https://auth.example/device'), true)
  assertEquals(output.includes('workspace permissions'), true)
  assertEquals(output.includes('provider_error'), true)
  render(null, target)
})

Deno.test('the TUI account names each Codex request in progress', () => {
  let root = new TElement('root')
  let target = root as unknown as Parameters<typeof render>[1]
  let status: AccountStatus = {
    provider: 'codex',
    state: 'pending',
    ready: false,
    auth: null,
    login: 'browser',
  }
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
  for (let [busy, message] of cases) {
    render(
      h(
        'div',
        null,
        h(TAccount, { view: { status, busy } }),
        h('footer', null),
      ),
      target,
    )
    let output = pane(root).lines.flat().map((part) => part.text).join('\n')
    assertEquals(output.includes(message), true)
  }
  render(null, target)
})

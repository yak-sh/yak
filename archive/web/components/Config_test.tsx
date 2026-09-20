// The Configuration panel paints a setting's effective source, a credential's
// state, and never a secret value: the secret input is empty and masked, and
// the panel is titled for what it is, not for a provider.
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { account } from '../account_client.ts'
import type { AccountStatus } from '../accounts.ts'
import { config, type CredsDoor, type SettingsDoor } from '../config_client.ts'
import { Config, configKey, configOpen, dismissConfig } from './Config.tsx'

let settingsDoor: SettingsDoor = {
  list: () =>
    Promise.resolve([{
      key: 'OLLAMA_BASE_URL',
      label: 'Ollama base URL',
      group: 'ollama',
      type: 'url',
      help: 'base url',
      value: 'https://saved.example',
      source: 'graph',
      eid: 'e1',
    }]),
}
let credsDoor: CredsDoor = {
  list: () =>
    Promise.resolve([{
      key: 'OLLAMA_API_KEY',
      state: 'missing',
      source: null,
    }]),
  save: (_k, _v) =>
    Promise.resolve({
      key: 'OLLAMA_API_KEY',
      state: 'configured',
      source: 'local',
    }),
  bind: (_k, _r) =>
    Promise.resolve({
      key: 'OLLAMA_API_KEY',
      state: 'configured',
      source: 'op',
    }),
  reset: () =>
    Promise.resolve({ key: 'OLLAMA_API_KEY', state: 'missing', source: null }),
  refresh: () =>
    Promise.resolve({ key: 'OLLAMA_API_KEY', state: 'missing', source: null }),
  test: () =>
    Promise.resolve({ key: 'OLLAMA_API_KEY', state: 'missing', source: null }),
}

let signedOut = (): AccountStatus => ({
  provider: 'codex',
  state: 'signed_out',
  ready: false,
  auth: null,
})
let codex = () =>
  account({
    status: () => Promise.resolve(signedOut()),
    login: () => Promise.resolve(signedOut()),
    complete: () => Promise.resolve(signedOut()),
    cancel: () => Promise.resolve(signedOut()),
    logout: () => Promise.resolve(signedOut()),
  })

Deno.test('config panel shows effective source, credential state, and no secret', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let ctl = config(settingsDoor, credsDoor, () => {}, () => 'x')
  let acc = codex()
  // The two planes as the server last reported them; drafts stay in the DOM.
  ctl.view.value = {
    settings: [{
      key: 'OLLAMA_BASE_URL',
      label: 'Ollama base URL',
      group: 'ollama',
      type: 'url',
      help: 'base url',
      value: 'https://saved.example',
      source: 'graph',
      eid: 'e1',
    }],
    creds: [{ key: 'OLLAMA_API_KEY', state: 'missing', source: null }],
    rowError: {},
  }
  let root = document.querySelector('main')!
  try {
    configOpen.value = true
    render(h(Config, { control: ctl, codex: acc }), root)

    // Titled for what it is, not a provider.
    assertEquals(
      root.querySelector('.Config_Title')?.textContent,
      'Configuration',
    )

    // The non-secret setting's effective source is painted.
    let source = root.querySelector('.Config_Source')
    assertEquals(source?.getAttribute('data-source'), 'graph')
    assertStringIncludes(source?.textContent ?? '', 'saved here')

    // The credential shows only state — no value anywhere.
    let state = root.querySelector('.Config_State')
    assertEquals(state?.getAttribute('data-state'), 'missing')
    assertStringIncludes(state?.textContent ?? '', 'not configured')

    // The secret input is masked and empty — never prefilled or echoed.
    let inputs = [...root.querySelectorAll('.Config_Input')] as unknown as {
      getAttribute: (n: string) => string | null
      value: string
    }[]
    let secret = inputs.find((i) => i.getAttribute('type') == 'password')
    assert(secret, 'the secret field is a masked password input')
    assertEquals(secret!.value, '')

    // Backend choice is offered (local secret vs 1Password op://).
    assertEquals(root.querySelectorAll('.Config_Select option').length, 2)

    // The Codex ceremony rides along as its own section.
    assert(root.querySelector('.Account_State'), 'the Codex section is present')
  } finally {
    configOpen.value = false
    ctl.close()
    acc.close()
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('config panel owns Escape but leaves fields and activation alone', () => {
  let stopped = 0, prevented = 0
  let event = (key: string, matches = false) => ({
    key,
    target: { matches: () => matches },
    stopImmediatePropagation: () => stopped++,
    preventDefault: () => prevented++,
  })
  configOpen.value = true
  assertEquals(configKey(event('?')), true)
  assertEquals({ stopped, prevented }, { stopped: 1, prevented: 1 })
  configKey(event('Tab'))
  configKey(event('a', true)) // typing into a field is not stolen
  assertEquals({ stopped, prevented }, { stopped: 3, prevented: 1 })
  configKey(event('Escape'))
  assertEquals({ open: configOpen.value, prevented }, {
    open: false,
    prevented: 2,
  })
  dismissConfig()
})

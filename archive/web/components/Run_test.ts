// DOM-mount tests for the <Run/> form — they render the real form through
// Preact + linkedom (heavy Run.tsx import), so they can't hit the 1ms budget.
// The PURE catalog test moved to Run_catalog_test.ts (light imports, sub-ms).
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { assertEquals } from '@std/assert'
import { codexAccount } from '../account_client.ts'
import { providers as loaded, Run, run } from './Run.tsx'

Deno.test('signed-out Codex offers login without blocking a raw spawn', async () => {
  let prior = Object.entries({
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
    ResizeObserver: Object.getOwnPropertyDescriptor(
      globalThis,
      'ResizeObserver',
    ),
    innerWidth: Object.getOwnPropertyDescriptor(globalThis, 'innerWidth'),
    innerHeight: Object.getOwnPropertyDescriptor(globalThis, 'innerHeight'),
  })
  let { document } = parseHTML('<main></main>')
  let status = {
    provider: 'codex' as const,
    state: 'signed_out' as const,
    ready: false,
    auth: null,
  }
  Object.defineProperties(globalThis, {
    document: { value: document, configurable: true },
    fetch: {
      value: () => Promise.resolve(Response.json(status)),
      configurable: true,
    },
    ResizeObserver: {
      value: class {
        observe() {}
        disconnect() {}
      },
      configurable: true,
    },
    innerWidth: { value: 1000, configurable: true },
    innerHeight: { value: 800, configurable: true },
  })
  let root = document.querySelector('main')!
  try {
    loaded.value = [{
      name: 'codex',
      models: ['gpt-5.6-sol'],
      efforts: ['medium'],
      labels: { 'gpt-5.6-sol': 'Sol' },
    }]
    codexAccount.view.value = { status }
    run.value = { eid: 'task', x: 10, y: 10 }
    render(h(Run, null), root)
    await Promise.resolve()
    assertEquals(root.querySelector('.Run_State')?.textContent, 'signed out')
    assertEquals(root.querySelector('.Run_Account')?.textContent, 'log in')
    assertEquals(root.querySelector('.Run_Go')?.hasAttribute('disabled'), false)
  } finally {
    run.value = null
    loaded.value = []
    render(null, root)
    for (let [name, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete (globalThis as Record<string, unknown>)[name]
    }
  }
})

Deno.test('the CLI fallback never presents the direct account door', async () => {
  let prior = Object.entries({
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
    ResizeObserver: Object.getOwnPropertyDescriptor(
      globalThis,
      'ResizeObserver',
    ),
    innerWidth: Object.getOwnPropertyDescriptor(globalThis, 'innerWidth'),
    innerHeight: Object.getOwnPropertyDescriptor(globalThis, 'innerHeight'),
  })
  let { document } = parseHTML('<main></main>')
  Object.defineProperties(globalThis, {
    document: { value: document, configurable: true },
    fetch: {
      value: () => Promise.reject(Error('account door must stay closed')),
      configurable: true,
    },
    ResizeObserver: {
      value: class {
        observe() {}
        disconnect() {}
      },
      configurable: true,
    },
    innerWidth: { value: 1000, configurable: true },
    innerHeight: { value: 800, configurable: true },
  })
  let root = document.querySelector('main')!
  try {
    loaded.value = [{
      name: 'codex-cli',
      models: ['gpt-5.6-sol'],
      efforts: ['medium'],
      labels: { 'gpt-5.6-sol': 'Sol (CLI fallback)' },
    }]
    run.value = { eid: 'task', x: 10, y: 10 }
    render(h(Run, null), root)
    await Promise.resolve()
    assertEquals(root.querySelector('.Run_State'), null)
    assertEquals(root.querySelector('.Run_Account'), null)
    assertEquals(root.querySelector('.Run_Go')?.hasAttribute('disabled'), false)
  } finally {
    run.value = null
    loaded.value = []
    render(null, root)
    for (let [name, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete (globalThis as Record<string, unknown>)[name]
    }
  }
})

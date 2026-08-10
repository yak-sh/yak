// The statusbar's command door and graph-backed spawn answer: its left side
// enters command mode; session messages follow server-minted ids and lifecycle.
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { assertEquals } from '@std/assert'
import { applyLocal, cache, mode } from '../live.ts'
import { commandFocus, commandMode, FixMessage } from './Status.tsx'

Deno.test('the statusbar left side enters command mode', () => {
  mode.value = 'normal'
  commandMode()
  assertEquals(mode.value, 'command')
})

Deno.test('colon refocuses an open command without consuming its own text', () => {
  let focused = 0
  let prevented = 0
  let input = { focus: () => focused++ } as unknown as HTMLTextAreaElement
  let key = (value: string, target: EventTarget | null) => ({
    key: value,
    target,
    preventDefault: () => prevented++,
  })

  assertEquals(commandFocus(key(':', null), input), true)
  assertEquals(commandFocus(key(':', input), input), false)
  assertEquals(commandFocus(key('x', null), input), false)
  assertEquals({ focused, prevented }, { focused: 1, prevented: 1 })
})

Deno.test('fix status links minted ids and follows the session lifecycle', async () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  try {
    cache.value = {
      task: {
        entity: { eid: 'task', num: 26 },
        task: { eid: 'task', status: 'open', priority: 0 },
      },
      session: {
        session: { eid: 'session', id: 'provider-id' },
      },
    }
    render(h(FixMessage, { task: 'task', session: 'session' }), root)
    assertEquals(root.textContent, 'T-26 → agent starting')
    assertEquals(root.querySelectorAll('a').length, 1)

    applyLocal([
      {
        eid: 'session',
        name: 'entity',
        comp: { eid: 'session', num: 31 },
      },
      { eid: 'session', name: 'session', comp: { status: 'running' } },
    ])
    await Promise.resolve()
    assertEquals(root.textContent, 'T-26 → S-31 running')
    assertEquals(
      [...root.querySelectorAll('a')].map((a) => a.getAttribute('href')),
      ['/T-26', '/S-31'],
    )
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

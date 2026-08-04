// The statusbar's graph-backed spawn answer: server-minted ids and lifecycle,
// never optimistic placeholders.
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { assertEquals } from '@std/assert'
import { applyLocal, cache } from '../live.ts'
import { FixMessage } from './Status.tsx'

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

// The inbox line names and opens the thing that asked for attention.
import { render } from 'preact'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { cache, ent } from '../../live.ts'
import { Inbox } from './Inbox.tsx'

Deno.test('a knock names and opens its target', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  cache.value = {
    person: {
      entity: { eid: 'person', num: 1 },
      person: { eid: 'person' },
    },
    knock: {
      entity: { eid: 'knock', num: 2 },
      knock: { eid: 'knock', to_eid: 'person', target_eid: 'project' },
    },
    project: {
      entity: { eid: 'project', num: 30 },
      doc: { eid: 'project', title: 'PrintBound', body: '' },
      project: { eid: 'project' },
    },
  }
  let root = document.querySelector('main')!
  try {
    render(<Inbox e={ent('person')} />, root)
    let line = root.querySelector('.Inbox_Title')
    assertEquals(line?.textContent, 'P-30 — PrintBound')
    assertEquals(line?.getAttribute('href'), '/P-30')
    assertEquals(root.querySelector('.Id')?.textContent, 'K-2')
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

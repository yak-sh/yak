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
      knock: { eid: 'knock', target_eid: 'project' },
      deliver: { eid: 'knock', to: 'person' },
      created: { eid: 'knock', at: '2026-08-07T12:00:00.000Z' },
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
    let line = root.querySelector('.ListTile')
    assertEquals(
      line?.querySelector('.ListTile_Title')?.textContent,
      'PrintBound',
    )
    assertEquals(line?.getAttribute('href'), '/P-30')
    assertEquals(
      [...root.querySelectorAll('.Id')].map((id) => id.textContent),
      ['P-30', 'K-2'],
    )
    assertEquals(root.querySelector('.List > .List_Row') != null, true)
    assertEquals(
      root.querySelector('.Dot-unread')?.getAttribute('title'),
      'unread',
    )
    assertEquals(root.querySelector('.List_Label')?.textContent, 'knock')
    assertEquals(root.querySelector('.Stamp') != null, true)
    assertEquals(
      root.querySelector('.List_Action')?.getAttribute('title'),
      'archive',
    )
    assertEquals(root.querySelector('[class^="Inbox"]'), null)
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

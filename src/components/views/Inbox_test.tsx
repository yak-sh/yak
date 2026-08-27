// The inbox line names and opens the thing that asked for attention.
import { render } from 'preact'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { cache, ent, rows, setInbox } from '../../live.ts'
import { Inbox } from './Inbox.tsx'

// Membership now comes from ordinary query subscriptions, so these rendering
// tests plant finished rows directly and assert only the view's job: naming,
// order, unread count and limit.
let seedInbox = (eid: string) =>
  setInbox(eid, rows().filter((r) => r.comps.knock || r.comps.comment))

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
      knock: { eid: 'knock', target: 'project' },
      deliver: { eid: 'knock', to: 'person' },
      created: { eid: 'knock', at: '2026-08-07T12:00:00.000Z' },
    },
    project: {
      entity: { eid: 'project', num: 30 },
      doc: { eid: 'project', title: 'PrintBound', body: '' },
      project: { eid: 'project' },
    },
  }
  seedInbox('person')
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

Deno.test('reading an inbox item keeps the order', () => {
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
    older: {
      entity: { eid: 'older', num: 2 },
      doc: { eid: 'older', title: 'Older', body: '' },
      comment: { eid: 'older', target: 'person' },
      created: { eid: 'older', at: '2026-08-07T12:00:00.000Z' },
    },
    newer: {
      entity: { eid: 'newer', num: 3 },
      doc: { eid: 'newer', title: 'Newer', body: '' },
      comment: { eid: 'newer', target: 'person' },
      created: { eid: 'newer', at: '2026-08-07T13:00:00.000Z' },
      opened: { eid: 'newer' },
    },
  }
  seedInbox('person')
  let root = document.querySelector('main')!
  try {
    render(<Inbox e={ent('person')} />, root)
    assertEquals(
      [...root.querySelectorAll('.ListTile_Title')].map((e) => e.textContent),
      ['Newer', 'Older'],
    )
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('a limited inbox keeps the whole count and bounds its rows', () => {
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
    ...Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`comment-${i}`, {
        entity: { eid: `comment-${i}`, num: i + 2 },
        doc: { eid: `comment-${i}`, title: `Comment ${i}`, body: '' },
        comment: { eid: `comment-${i}`, target: 'person' },
        created: { eid: `comment-${i}`, at: `2026-08-07T12:00:${i}Z` },
      }]),
    ),
  }
  seedInbox('person')
  let root = document.querySelector('main')!
  try {
    render(<Inbox e={ent('person')} limit={8} />, root)
    assertEquals(
      root.querySelector('.List_Summary')?.textContent,
      '10 items · 10 unread',
    )
    assertEquals(root.querySelectorAll('.ListTile').length, 8)
    assertEquals(root.querySelector('.List_Row-more')?.textContent, '+2 more')
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

import { test, until } from '@yaks/testing'
import '../testing.ts'
import { docs as schemaDocs } from '@yaks/vocab/vocab'
import { learn, vocab } from '../types.ts'
learn([...vocab.docs, ...schemaDocs])
import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { identityEid } from '@yaks/graph'
import { parse } from '@yaks/query'
import { cache, useRoute } from '../live.ts'
import { extend } from './registry.ts'
import { Navigation, toggleNavigation } from './Navigation.tsx'
import { fields } from './fields.tsx'
import { mount } from './mount.ts'

// A non-doc kind must paint via the shared registry, not as a blank doc row.
test('sidebar narrows registry entries and restores folded sections on remount', async () => {
  let a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  let restore = useRoute(() => {})
  cache.value = {
    [a]: {
      entity: { eid: a, num: 1 },
      favorite: { eid: a },
      doc: { eid: a, title: 'Alpha' },
    },
    [b]: {
      entity: { eid: b, num: 2 },
      favorite: { eid: b },
      board: { eid: b, query: '.task' },
    },
  }
  extend([{
    view: 'Sidebar.Tile',
    match: parse('.favorite'),
    Render: ({ e }) => <span>Registry {e.eid == a ? 'Alpha' : 'Beta'}</span>,
  }])
  fields.set('sidebar:query', '')
  toggleNavigation(true)
  let mounted = mount(h(Navigation, {}))
  try {
    assertEquals(
      [...mounted.root.querySelectorAll('[aria-label]')].filter((n) =>
        n.classList.contains('Index_Group')
      ).map((n) => n.getAttribute('aria-label')),
      [
        'Inbox',
        'Favorites',
        'Packages',
        'Saved searches',
        'Recent',
        'Sessions',
      ],
    )
    assertEquals(mounted.root.textContent!.includes('Registry Beta'), true)
    fields.set('sidebar:query', 'alpha')
    await until(() => !mounted.root.textContent!.includes('Registry Beta'))
    assertEquals(mounted.root.textContent!.includes('Registry Alpha'), true)
    fields.set('sidebar:query', '')
    await until(() => mounted.root.textContent!.includes('Registry Beta'))
    let head = mounted.root.querySelector(
      '[aria-label="Favorites"] .Index_Head',
    ) as HTMLElement
    head.click()
    await until(() => !mounted.root.textContent!.includes('Registry Alpha'))
    mounted.free()
    mounted = mount(h(Navigation, {}))
    assertEquals(
      mounted.root.querySelector('[aria-label="Favorites"] .Index_Head')!
        .getAttribute('aria-expanded'),
      'false',
    )
  } finally {
    mounted.free()
    fields.set('sidebar:query', '')
    toggleNavigation(false)
    cache.value = {}
    useRoute(restore)
  }
})

test('expanding a package shows its declared components through the registry', async () => {
  let p = identityEid('_package', ['Test pack'])
  let c = identityEid('_comp', ['task'])
  let restore = useRoute(() => {})
  cache.value = {
    [p]: {
      entity: { eid: p, num: 3 },
      _package: { name: 'Test pack' },
      doc: { eid: p, title: 'Test pack' },
    },
    [c]: {
      entity: { eid: c, num: 4 },
      _comp: { name: 'task', package: p },
      doc: { eid: c, title: 'task' },
    },
  }
  extend([{
    view: 'Sidebar.Tile',
    match: parse('._comp'),
    Render: () => <span>Registry component</span>,
  }])
  fields.set('sidebar:query', '')
  toggleNavigation(true)
  let mounted = mount(h(Navigation, {}))
  try {
    let button = mounted.root.querySelector(
      '[aria-label="Toggle package components"]',
    ) as HTMLElement
    assertEquals(!!button, true)
    button.click()
    await until(() => mounted.root.textContent!.includes('Registry component'))
  } finally {
    mounted.free()
    cache.value = {}
    useRoute(restore)
    toggleNavigation(false)
  }
})

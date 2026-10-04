import { test, until } from '@yaks/testing'
import '../testing.ts'
import { assertEquals } from '@std/assert'
import { h } from 'preact'
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
    [a]: { entity: { eid: a, num: 1 }, favorite: {}, doc: { title: 'Alpha' } },
    [b]: {
      entity: { eid: b, num: 2 },
      favorite: {},
      board: { query: '.task' },
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

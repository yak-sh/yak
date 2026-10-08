// What a package offers the app's places from its `./views` facet: the
// owner's home page, tabs on what its views draw, and what waits there. A
// stand-in package (a desk) offers each; without it, `/` is the host's list.
import { test } from '@yaks/testing'
import '../testing.ts'
import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { parse } from '@yaks/query'
import type { View } from '@yaks/inspect'
import { cache, config, ent, owner } from '../live.ts'
import { host } from '../host_testing.ts'
import { bindHistory } from '../history.ts'
import { vocab } from '../types.ts'
import { mount } from './mount.ts'
import { Page } from './App.tsx'
import { Navigation } from './Navigation.tsx'
import { TabFace } from './Card.tsx'
import { Dashboard } from './views/Dashboard.tsx'
import { applicable, registry } from './registry.ts'
import { contribute, type Facet } from './inspect.tsx'
import { offerPlaces } from './offers.ts'
import '../domain-host.tsx'

let OWNER = 'aaaaaaaa-0000-4000-8000-00000000000a'
let PROJECT = 'aaaaaaaa-0000-4000-8000-00000000000b'

// What waits at the desk: whatever the test says, per entity.
let waits: Record<string, number> = {}
let desk: View = {
  view: 'Desk',
  match: parse('.person'),
  Render: ({ e, io, ctx }) =>
    h(
      'p',
      { class: 'Desk' },
      `desk of ${io.name(e.entity.eid)} · ${ctx.limit ?? 'all'}`,
    ),
}
let facet: Facet = {
  inspectViews: [desk, { ...desk, match: parse('.project') }],
  home: {
    name: 'Desk',
    icon: 'lamp',
    view: 'Desk',
    waiting: (e) => waits[e.entity.eid],
  },
  tabs: [{ view: 'Desk', icon: 'lamp', waiting: (e) => waits[e.entity.eid] }],
  icons: { lamp: [['circle', { cx: '12', cy: '12', r: '4' }]] },
}

let world = (offered: boolean) => {
  let prior = { renderers: registry.renderers, host: config.host }
  config.host = 'browser.test'
  let wire = host(() => ({ bundles: [] }))
  cache.value = {
    [OWNER]: {
      entity: { eid: OWNER, num: 1 },
      person: { eid: OWNER },
      doc: { eid: OWNER, title: 'Owner', body: '' },
    },
    [PROJECT]: {
      entity: { eid: PROJECT, num: 2 },
      project: { eid: PROJECT },
      doc: { eid: PROJECT, title: 'Venture', body: '' },
    },
  }
  owner.value = OWNER
  waits = {}
  bindHistory(undefined)
  if (offered) contribute([facet])
  return {
    wire,
    [Symbol.dispose]() {
      wire.free()
      registry.renderers = prior.renderers
      offerPlaces({})
      owner.value = undefined
      cache.value = {}
      config.host = prior.host
    },
  }
}

let text = (root: Element, selector: string) =>
  [...root.querySelectorAll(selector)].map((n) => n.textContent)

test('without an offered home page, / lists the host query and calls itself Home', async () => {
  using w = world(false)
  // A package declaring `subscription` is no home page.
  assertEquals(!!vocab.comp('subscription'), true)
  let seen = mount(h('div', {}, h(Navigation, {}), h(Page, { at: '/' })))
  try {
    await act(() => Promise.resolve())
    assertEquals(text(seen.root, '.Shell_Title'), ['Home'])
    assertEquals(seen.root.querySelector('.Desk'), null)
    assertEquals(
      w.wire.asked().some((a) => a.subscribe.startsWith('.doc')),
      true,
    )
    assertEquals(
      w.wire.asked().some((a) => a.subscribe.includes(OWNER)),
      false,
    )
    assertEquals(text(seen.root, '.Shell_Item')[0], 'Home')
    assertEquals(
      seen.root.querySelector('.Shell_Item .Icon')?.getAttribute('class'),
      'lucide lucide-house Icon',
    )
  } finally {
    seen.free()
  }
})

test('an offered home page draws the owner at /, names the first place and wears what waits', async () => {
  using w = world(true)
  waits[OWNER] = 120
  let seen = mount(h('div', {}, h(Navigation, {}), h(Page, { at: '/' })))
  try {
    await act(() => Promise.resolve())
    assertEquals(text(seen.root, '.Desk'), ['desk of Owner · all'])
    assertEquals(text(seen.root, '.Shell_Title'), ['Desk'])
    // The page holds what its view asks, not the owner's neighborhood.
    assertEquals(
      w.wire.asked().some((a) => a.subscribe.includes(OWNER)),
      false,
    )
    let first = seen.root.querySelector('.Shell_Item')!
    assertEquals(first.getAttribute('href'), '/')
    assertEquals(text(first, '.Shell_Label'), ['Desk'])
    assertEquals(
      first.querySelector('.Icon')?.getAttribute('class'),
      'lucide lucide-lamp Icon',
    )
    assertEquals(first.querySelector('.Icon circle') != null, true)
    assertEquals(text(first, '.Shell_Count'), ['99+'])
  } finally {
    seen.free()
  }
  owner.value = undefined
  let ownerless = mount(h(Page, { at: '/' }))
  try {
    assertEquals(text(ownerless.root, 'h1'), ['Desk'])
  } finally {
    ownerless.free()
  }
})

test('offered tabs come first on what they draw, wear what waits, and fill a cockpit cell', async () => {
  using _ = world(true)
  waits[PROJECT] = 3
  assertEquals(applicable(ent(OWNER))[0], 'Desk')
  let tabs = applicable(ent(PROJECT))
  assertEquals(tabs[0], 'Desk')
  assertEquals(tabs.includes('Dashboard'), true)
  let seen = mount(
    h(
      'div',
      {},
      h('nav', { id: 'waiting' }, h(TabFace, { view: 'Desk', eid: PROJECT })),
      h('nav', { id: 'quiet' }, h(TabFace, { view: 'Desk', eid: OWNER })),
      h(Dashboard, { e: ent(PROJECT) }),
    ),
  )
  try {
    await act(() => Promise.resolve())
    assertEquals(
      seen.root.querySelector('#waiting .Icon')?.getAttribute('class'),
      'lucide lucide-lamp Icon',
    )
    assertEquals(text(seen.root, '#waiting .Tabs_Badge'), ['3'])
    assertEquals(text(seen.root, '#quiet .Tabs_Badge'), [])
    let cell = [...seen.root.querySelectorAll('.Dash_Cell')]
      .find((c) => c.querySelector('.Desk'))!
    assertEquals(text(cell, '.Dash_Name'), ['desk3'])
    assertEquals(text(cell, '.Desk'), ['desk of Venture · 8'])
  } finally {
    seen.free()
  }
})

test('without the offering package, nothing is offered on what it would draw', () => {
  using _ = world(false)
  assertEquals(applicable(ent(PROJECT)).includes('Desk'), false)
  let cockpit = mount(h(Dashboard, { e: ent(PROJECT) }))
  try {
    assertEquals(
      text(cockpit.root, '.Dash_Name').map((n) => n?.replace(/\d+$/, '')),
      ['boards', 'roles', 'sessions', 'lately'],
    )
  } finally {
    cockpit.free()
  }
})

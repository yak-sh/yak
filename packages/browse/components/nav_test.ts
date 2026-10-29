// Links peek their entity or open its page; menus and routes resolve ids.
import { test } from '@yaks/testing'
import { until } from '../testing.ts'
import { parseHTML } from 'linkedom'
import { assertEquals, assertStrictEquals } from '@std/assert'
import {
  cache,
  clearResolved,
  ent,
  landSub,
  peeked,
  unsubscribe,
} from '../live.ts'
import { host } from '../host_testing.ts'
import { type Ent, idOf } from '../types.ts'
import {
  actionsAt,
  cardMenuAt,
  clickProps,
  eidOf,
  menu,
  openAt,
  route,
  screenResolving,
  screenTarget,
} from './nav.tsx'
import './Entity.tsx'
import { Id } from './views/Inline.tsx'
import { mount } from './mount.ts'

let e: Ent = {
  eid: 'task',
  num: 7,
  kind: 'task',
  refs: [],
  kids: [],
}

// Two tasks to press, held and read once as the file loads, so no case pays
// for building the page's index.
landSub({
  sub: 'pressed',
  replace: true,
  changes: ([['task', 7], ['other', 8]] as const).flatMap(([eid, num]) => [
    { eid, name: 'entity', comp: { eid, num } },
    { eid, name: 'task', comp: { eid } },
  ]),
})
idOf(ent('task'))

// Presses on a page that is no entity's, by a fine pointer or a coarse one:
// where the page is, and what is peeked, after each.
let pressed = (fine: boolean, ...eids: string[]) => {
  let priorMedia = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
  Object.defineProperty(globalThis, 'matchMedia', {
    value: (q: string) => ({ matches: fine && q == '(pointer: fine)' }),
    configurable: true,
  })
  try {
    route.value = '/?page=recent'
    return eids.map((eid) => {
      openAt(eid, {} as MouseEvent)
      return [route.value, peeked.value?.eid]
    })
  } finally {
    peeked.value = null
    if (priorMedia) Object.defineProperty(globalThis, 'matchMedia', priorMedia)
    else delete (globalThis as { matchMedia?: unknown }).matchMedia
  }
}

test('a fine pointer peeks a link over the page, one at a time', () => {
  assertEquals(pressed(true, 'task', 'other'), [
    ['/?page=recent', 'task'],
    ['/?page=recent', 'other'],
  ])
})

test('a link to what is peeked opens its page', () => {
  assertEquals(pressed(true, 'other', 'other')[1], ['/T-8', undefined])
})

test('a coarse pointer opens the page at once', () => {
  assertEquals(pressed(false, 'task'), [['/T-7', undefined]])
})

test('numeric routes resolve confirmed retained rows before a reopen frame', () => {
  cache.value = {}
  try {
    landSub({
      sub: 'route:retained',
      replace: true,
      changes: [
        {
          eid: 'retained',
          name: 'entity',
          comp: { eid: 'retained', num: 12345 },
        },
      ],
    })
    unsubscribe('route:retained')
    assertEquals(eidOf('T-12345'), 'retained')
    assertEquals(eidOf('12345'), 'retained')
  } finally {
    cache.value = {}
  }
})

// A card's body, and a link inside it, read once as the file loads.
let card = parseHTML(
  '<div id="body"></div><a id="link"><span id="inside"></span></a>',
)
let cardBody = card.document.querySelector('#body')!
let inLink = card.document.querySelector('#inside')!
test('a card menu leaves nested controls and links to themselves', () => {
  let priorElement = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  let { window } = card
  Object.defineProperty(globalThis, 'Element', {
    value: window.Element,
    configurable: true,
  })
  let event = (target: Element) => {
    let prevented = false
    let stopped = false
    return {
      target,
      clientX: 12,
      clientY: 34,
      preventDefault: () => (prevented = true),
      stopPropagation: () => (stopped = true),
      handled: () => [prevented, stopped],
    }
  }

  try {
    let body = event(cardBody)
    cardMenuAt(e)(body as unknown as MouseEvent)
    assertEquals(body.handled(), [true, true])
    assertEquals(menu.value?.eid, e.eid)

    menu.value = null
    let link = event(inLink)
    cardMenuAt(e)(link as unknown as MouseEvent)
    assertEquals(link.handled(), [false, false])
    assertEquals(menu.value, null)
  } finally {
    menu.value = null
    if (priorElement) {
      Object.defineProperty(globalThis, 'Element', priorElement)
    } else delete (globalThis as { Element?: unknown }).Element
  }
})

test('an entity link opens its target menu', () => {
  let prevented = false
  let stopped = false
  let ev = {
    clientX: 12,
    clientY: 34,
    preventDefault: () => (prevented = true),
    stopPropagation: () => (stopped = true),
  } as unknown as MouseEvent

  try {
    clickProps(e).onContextMenu(ev)
    assertEquals([prevented, stopped], [true, true])
    assertEquals(menu.value?.eid, e.eid)
  } finally {
    menu.value = null
  }
})

test('a point menu carries only the actions its host gives it', () => {
  let handled = 0
  let acts = [{ label: 'doc', run: () => {} }]
  let ev = {
    clientX: 12,
    clientY: 34,
    preventDefault: () => handled++,
    stopPropagation: () => handled++,
  } as unknown as MouseEvent

  try {
    actionsAt(acts)(ev)
    assertEquals(handled, 2)
    assertStrictEquals(menu.value?.acts, acts)
    assertEquals(menu.value?.eid, undefined)
  } finally {
    menu.value = null
  }
})

test('short id chip and browser route round trip; a lettered handle is lost', async () => {
  let eid = '3f9a1c2e-7b00-4000-8000-000000000001'
  let before = cache.peek()
  cache.value = { [eid]: { entity: { eid, num: 0 }, task: { eid } } }
  clearResolved()
  let wire = host(() => ({ bundles: [{ entity: { eid, num: 0 }, task: {} }] }))
  let ready = (path: string) => {
    screenTarget(path)
    return until(() => !screenResolving(path))
  }
  try {
    let row = { ...e, eid, num: 0 }
    let props = clickProps(row)
    assertEquals(props.href, '/3f9a1c2e7b')
    await ready(props.href)
    assertEquals(screenTarget(props.href)?.eid, eid)
    await ready('/T%233f9a1c2e7b')
    // A handle carries no letter, so one written with a letter is Lost.
    assertEquals(screenTarget('/T%233f9a1c2e7b'), null)
    let { root, free } = mount(Id({ e: row }))
    try {
      assertEquals(root.textContent, '#3f9a1c2e7b')
      assertEquals(root.querySelector('a')?.getAttribute('href'), props.href)
    } finally {
      free()
    }
  } finally {
    wire.free()
    clearResolved()
    cache.value = before
  }
})

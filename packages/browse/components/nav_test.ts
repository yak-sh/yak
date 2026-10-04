// A peek belongs to its one opener without making every link reactive.
import { test } from '@yaks/testing'
import { until } from '../testing.ts'
import { effect } from '@preact/signals'
import { parseHTML } from 'linkedom'
import { assertEquals, assertStrictEquals } from '@std/assert'
import {
  cache,
  clearResolved,
  landSub,
  peek as shellPeek,
  unsubscribe,
} from '../live.ts'
import { host } from '../host_testing.ts'
import { type Ent } from '../types.ts'
import {
  actionsAt,
  cardMenuAt,
  clickProps,
  eidOf,
  menu,
  openAt,
  peek,
  route,
  screenResolving,
  screenTarget,
} from './nav.tsx'
import { Id } from './views/Inline.tsx'
import { mount } from './mount.ts'

let e: Ent = {
  eid: 'task',
  num: 7,
  kind: 'task',
  refs: [],
  kids: [],
}

import { frames } from '../history.ts'
import { panesOf } from '@yaks/ux'

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

test('peek state lives above the hot-swap boundary', () => {
  assertStrictEquals(peek, shellPeek)
})

test('following an entity stacks its main page on either pointer kind', () => {
  let priorMedia = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
  let prior = cache.peek()
  cache.value = {
    task: { entity: { eid: 'task', num: 7 }, task: { eid: 'task' } },
    other: { entity: { eid: 'other', num: 8 }, task: { eid: 'other' } },
  }
  try {
    Object.defineProperty(globalThis, 'matchMedia', {
      value: () => ({ matches: true }),
      configurable: true,
    })
    openAt('task', {} as MouseEvent)
    assertEquals(route.value, '/T-7')
    Object.defineProperty(globalThis, 'matchMedia', {
      value: () => ({ matches: false }),
      configurable: true,
    })
    openAt('other', {} as MouseEvent)
    assertEquals(route.value, '/T-8')
    assertEquals(panesOf(frames.value).slice(-2), ['/T-7', '/T-8'])
    assertEquals(peek.value, [])
  } finally {
    cache.value = prior
    if (priorMedia) Object.defineProperty(globalThis, 'matchMedia', priorMedia)
    else delete (globalThis as { matchMedia?: unknown }).matchMedia
  }
})

test('a card menu leaves nested controls and links to themselves', () => {
  let priorElement = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  let { document, window } = parseHTML(
    '<div id="body"></div><a id="link"><span id="inside"></span></a>',
  )
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
    let body = event(document.querySelector('#body')!)
    cardMenuAt(e)(body as unknown as MouseEvent)
    assertEquals(body.handled(), [true, true])
    assertEquals(menu.value?.eid, e.eid)

    menu.value = null
    let link = event(document.querySelector('#inside')!)
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

test('link props do not subscribe to peek state', () => {
  let runs = 0
  let stop = effect(() => {
    clickProps(e)
    runs++
  })
  peek.value = [{ eid: e.eid, x: 1, y: 2 }]
  assertEquals(runs, 1)
  stop()
  peek.value = []
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
    assertEquals(props.href, '/%233f9a1c2e7b')
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

// A peek belongs to its one opener without making every link reactive.
import { effect } from '@preact/signals'
import { parseHTML } from 'linkedom'
import { assertEquals, assertStrictEquals, assertThrows } from '@std/assert'
import {
  cache,
  clearResolved,
  landSub,
  peek as shellPeek,
  unsubscribe,
  useRoute,
} from '../live.ts'
import { type Ent } from '../types.ts'
import {
  actionsAt,
  cardMenuAt,
  clickProps,
  eidOf,
  menu,
  openAt,
  peek,
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

let from = () => peek.value.at(-1)?.from

Deno.test('short id chip and browser route round trip; kind is checked', async () => {
  let eid = '3f9a1c2e-7b00-4000-8000-000000000001'
  let before = cache.peek()
  cache.value = { [eid]: { entity: { eid, num: 0 }, task: { eid } } }
  clearResolved()
  let prior = useRoute((frame) => {
    let { sub, q } = frame as { sub?: string; q?: string }
    if (!sub || !q) return
    queueMicrotask(() =>
      landSub({
        sub,
        replace: true,
        drop: [],
        changes: [
          { eid, name: 'entity', comp: { eid, num: 0 } },
          { eid, name: 'task', comp: { eid } },
        ],
        ...(q.includes('S#')
          ? { error: 'prefix S does not match task (T)' }
          : {}),
      })
    )
  })
  let ready = async (path: string) => {
    screenTarget(path)
    await new Promise((r) => setTimeout(r, 0))
  }
  try {
    let row = { ...e, eid, num: 0 }
    let props = clickProps(row)
    assertEquals(props.href, '/T%233f9a1c2e7b')
    await ready(props.href)
    assertEquals(screenTarget(props.href)?.eid, eid)
    await ready('/%233f9a1c2e7b')
    assertEquals(screenTarget('/%233f9a1c2e7b')?.eid, eid)
    await ready('/S%233f9a1c2e7b')
    assertThrows(() => screenTarget('/S%233f9a1c2e7b'), Error, 'prefix S')
    let { root, free } = mount(Id({ e: row }))
    try {
      assertEquals(root.textContent, 'T#3f9a1c2e7b')
      assertEquals(root.querySelector('a')?.getAttribute('href'), props.href)
    } finally {
      free()
    }
  } finally {
    useRoute(prior)
    clearResolved()
    cache.value = before
  }
})

Deno.test('numeric routes resolve confirmed retained rows before a reopen frame', () => {
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

Deno.test('peek state lives above the hot-swap boundary', () => {
  assertStrictEquals(peek, shellPeek)
})

Deno.test('only the same opener toggles its peek closed', () => {
  let priorMedia = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
  let priorElement = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  let { document, window } = parseHTML('<a id="a"></a><a id="b"></a>')
  Object.defineProperties(globalThis, {
    matchMedia: {
      value: () => ({ matches: true }),
      configurable: true,
    },
    Element: { value: window.Element, configurable: true },
  })
  let a = document.querySelector('#a')!
  let b = document.querySelector('#b')!
  let ev = (from: Element) =>
    ({
      currentTarget: from,
      target: from,
      clientX: 12,
      clientY: 34,
    }) as unknown as MouseEvent

  try {
    peek.value = []
    openAt(e.eid, ev(a))
    assertEquals(from(), a)

    openAt(e.eid, ev(b))
    assertEquals(from(), b)
    assertEquals(peek.value.length, 2)

    openAt(e.eid, ev(b))
    assertEquals(peek.value.length, 1)
    assertEquals(from(), a)
  } finally {
    peek.value = []
    if (priorMedia) Object.defineProperty(globalThis, 'matchMedia', priorMedia)
    else delete (globalThis as { matchMedia?: unknown }).matchMedia
    if (priorElement) {
      Object.defineProperty(globalThis, 'Element', priorElement)
    } else delete (globalThis as { Element?: unknown }).Element
  }
})

Deno.test('the current peek id stays mounted for double-click navigation', () => {
  let priorMedia = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
  let priorElement = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  let { document, window } = parseHTML(
    '<a id="from"></a><div class="Peek"><a id="id"></a></div>',
  )
  Object.defineProperties(globalThis, {
    matchMedia: {
      value: () => ({ matches: true }),
      configurable: true,
    },
    Element: { value: window.Element, configurable: true },
  })
  let opener = document.querySelector('#from')!
  let id = document.querySelector('#id')!
  let ev = {
    currentTarget: id,
    target: id,
    clientX: 12,
    clientY: 34,
  } as unknown as MouseEvent

  try {
    peek.value = [{ eid: e.eid, x: 1, y: 2, from: opener }]
    openAt(e.eid, ev)
    openAt(e.eid, ev)
    assertEquals(peek.value.at(-1)?.from, opener)
  } finally {
    peek.value = []
    if (priorMedia) Object.defineProperty(globalThis, 'matchMedia', priorMedia)
    else delete (globalThis as { matchMedia?: unknown }).matchMedia
    if (priorElement) {
      Object.defineProperty(globalThis, 'Element', priorElement)
    } else delete (globalThis as { Element?: unknown }).Element
  }
})

Deno.test('a card menu leaves nested controls and links to themselves', () => {
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

Deno.test('an entity link opens its target menu', () => {
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

Deno.test('a point menu carries only the actions its host gives it', () => {
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

Deno.test('link props do not subscribe to peek state', () => {
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

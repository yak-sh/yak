// The chat page's place in its conversation (public/follow.js), over a
// linkedom page with an independently scrolling conversation pane. As in a
// browser, scrolling is clamped to its content, and a fragment naming
// nothing (a link to `#`) sends the window to its top.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { follow } from './public/follow.js'

let page = (hash = '') => {
  let { document, Event } = parseHTML(
    `<html><body><nav id="menu"><a href="#">Close</a></nav>` +
      `<main id="content"><div data-conversation><div id="row-a"></div><div id="row-b"></div></div>` +
      `<button data-jump hidden></button></main><section id="app"></section></body></html>`,
  )
  let on: Record<string, (() => void)[]> = {}
  let grew: (() => void)[] = []
  let at = hash
  let w = {
    innerHeight: 800,
    scrollY: 0,
    height: 3000,
    history: { scrollRestoration: 'auto' },
    location: {
      get hash() {
        return at
      },
      set hash(h: string) {
        at = h ? '#' + h.replace(/^#/, '') : ''
        if (!at) w.scrollY = 0
      },
      replace(h: string) {
        w.location.hash = h
      },
    },
    scrollTo: (_x: number, y: number) =>
      void (w.scrollY = Math.max(0, Math.min(y, w.height - w.innerHeight))),
    addEventListener: (type: string, fn: () => void) =>
      void (on[type] ??= []).push(fn),
    ResizeObserver: class {
      constructor(fn: () => void) {
        grew.push(fn)
      }
      observe() {}
    },
  }
  let pane = document.getElementById('content') as HTMLElement
  let y = 0
  Object.defineProperties(pane, {
    clientHeight: { get: () => w.innerHeight },
    scrollHeight: { get: () => w.height },
    scrollTop: {
      get: () => y,
      set: (value: number) =>
        y = Math.max(0, Math.min(value, w.height - w.innerHeight)),
    },
  })
  let row = document.getElementById('row-a')!
  row.scrollIntoView = () => void (pane.scrollTop = 1000)
  let jump = document.querySelector('[data-jump]') as HTMLElement
  let fire = (type: string) => on[type]?.forEach((f) => f())
  let reader = follow(
    w as never,
    document.querySelector('[data-conversation]')!,
    jump,
    pane,
  )
  return {
    w,
    pane,
    preview: document.getElementById('app')!,
    Event,
    // The person scrolls, or the browser does.
    scroll: (
      y: number,
    ) => (pane.scrollTop = y, pane.dispatchEvent(new Event('scroll'))),
    grow: (by: number) => (w.height += by, grew.forEach((f) => f())),
    // The address's fragment changes: a link followed, or Back.
    hash: (h: string) => {
      w.location.hash = h
      fire('hashchange')
    },
    close: () => {
      let e = new Event('click', { bubbles: true, cancelable: true })
      document.querySelector('a[href="#"]')!.dispatchEvent(e)
      if (!e.defaultPrevented) w.location.hash = ''
      return e.defaultPrevented
    },
    jump: () => jump.dispatchEvent(new Event('click')),
    jumpShown: () => !jump.hasAttribute('hidden'),
    newest: () => pane.scrollTop == w.height - w.innerHeight,
    reader,
  }
}

test('a conversation opens at its newest entry, and no old place is restored over it', () => {
  let p = page()
  assert(p.newest())
  assertEquals(p.w.history.scrollRestoration, 'manual')
  assert(!p.jumpShown())
})

test('it stays at the newest as what is above it loads and as entries arrive', () => {
  let p = page()
  for (let by of [400, 0, 1200, -300]) p.grow(by), p.scroll(p.pane.scrollTop)
  assert(p.newest())
  assert(!p.jumpShown())
})

test('scrolled up to read, it stays there as the page grows, and jump takes it back', () => {
  let p = page()
  p.scroll(900)
  p.grow(600)
  assertEquals(p.pane.scrollTop, 900)
  assert(p.jumpShown())
  p.jump()
  assert(p.newest())
  assert(!p.jumpShown())
  p.grow(500)
  assert(p.newest())
})

test('scrolling back down to the newest follows the conversation again', () => {
  let p = page()
  p.scroll(500)
  p.scroll(2150)
  p.grow(700)
  assert(p.newest())
  assert(!p.jumpShown())
})

test('an address naming an entry opens at it, and the page stays there', () => {
  let p = page('#row-a')
  assertEquals(p.pane.scrollTop, 1000)
  assert(p.jumpShown())
  p.grow(800)
  assertEquals(p.pane.scrollTop, 1000)
})

test('closing the menu over it puts the conversation back where it was, not at its top', () => {
  for (let reading of [false, true]) {
    let p = page()
    if (reading) p.scroll(700)
    let was = p.pane.scrollTop
    p.hash('#menu')
    p.scroll(0)
    assert(p.close(), 'the link to # is not followed to the top')
    assertEquals(p.pane.scrollTop, was)
    // and as Back takes the menu off
    p.hash('#menu')
    p.hash('')
    assertEquals(p.pane.scrollTop, was)
  }
})

test('only scrolling the conversation changes whether it follows new entries', () => {
  for (let height of [800, 600]) {
    let p = page()
    p.w.innerHeight = height
    p.reader.newest()
    p.preview.scrollTop = 400
    p.preview.dispatchEvent(new p.Event('scroll'))
    p.grow(300)
    assert(p.newest())
    assertEquals(p.preview.scrollTop, 400)
    assertEquals(p.w.scrollY, 0)
    p.scroll(700)
    p.preview.scrollTop = 0
    p.preview.dispatchEvent(new p.Event('scroll'))
    p.grow(300)
    assertEquals(p.pane.scrollTop, 700)
    assert(p.jumpShown())
    p.reader.newest()
    assertEquals(p.preview.scrollTop, 0)
    assertEquals(p.w.scrollY, 0)
  }
})

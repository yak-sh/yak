// The chat page's place in its conversation (public/follow.js), over a
// linkedom page and a window that lays out a page of `height` pixels: as a
// browser does, a scroll is clamped to the page, and a fragment naming
// nothing (a link to `#`) sends the page to its top.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { follow } from './public/follow.js'

let page = (hash = '') => {
  let { document, Event } = parseHTML(
    `<html><body><nav id="menu"><a href="#">Close</a></nav>` +
      `<div data-conversation><div id="row-a"></div><div id="row-b"></div></div>` +
      `<button data-jump hidden></button></body></html>`,
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
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    get: () => w.height,
  })
  let row = document.getElementById('row-a')!
  row.scrollIntoView = () => w.scrollTo(0, 1000)
  let jump = document.querySelector('[data-jump]') as HTMLElement
  let fire = (type: string) => on[type]?.forEach((f) => f())
  let reader = follow(
    w as never,
    document.querySelector('[data-conversation]')!,
    jump,
  )
  return {
    w,
    // The person scrolls, or the browser does.
    scroll: (y: number) => (w.scrollTo(0, y), fire('scroll')),
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
    newest: () => w.scrollY == w.height - w.innerHeight,
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
  for (let by of [400, 0, 1200, -300]) p.grow(by), p.scroll(p.w.scrollY)
  assert(p.newest())
  assert(!p.jumpShown())
})

test('scrolled up to read, it stays there as the page grows, and jump takes it back', () => {
  let p = page()
  p.scroll(900)
  p.grow(600)
  assertEquals(p.w.scrollY, 900)
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
  assertEquals(p.w.scrollY, 1000)
  assert(p.jumpShown())
  p.grow(800)
  assertEquals(p.w.scrollY, 1000)
})

test('closing the menu over it puts the conversation back where it was, not at its top', () => {
  for (let reading of [false, true]) {
    let p = page()
    if (reading) p.scroll(700)
    let was = p.w.scrollY
    p.hash('#menu')
    p.scroll(0)
    assert(p.close(), 'the link to # is not followed to the top')
    assertEquals(p.w.scrollY, was)
    // and as Back takes the menu off
    p.hash('#menu')
    p.hash('')
    assertEquals(p.w.scrollY, was)
  }
})

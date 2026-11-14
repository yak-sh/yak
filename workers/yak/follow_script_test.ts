// The chat page's place in its conversation under a layer over it
// (public/follow.js), over a linkedom page with an independently scrolling
// conversation pane. As in a browser, scrolling is clamped to its content,
// and a fragment naming nothing (a link to `#`) sends the window to its top.
// Following the newest line is @yaks/ux Conversation's (its own tests).
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { follow } from './public/follow.js'

let page = (hash = '') => {
  let { document, Event } = parseHTML(
    `<html><body><nav id="menu"><a href="#">Close</a></nav>` +
      `<main id="content"><div data-conversation><div id="row-a"></div><div id="row-b"></div></div>` +
      `</main><section id="app"></section></body></html>`,
  )
  let on: Record<string, (() => void)[]> = {}
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
  let fire = (type: string) => on[type]?.forEach((f) => f())
  follow(w as never, document.querySelector('[data-conversation]')!, pane)
  return {
    w,
    pane,
    // The person scrolls, or the browser does.
    scroll: (
      y: number,
    ) => (pane.scrollTop = y, pane.dispatchEvent(new Event('scroll'))),
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
  }
}

test('no old place is restored over the conversation', () => {
  assertEquals(page().w.history.scrollRestoration, 'manual')
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

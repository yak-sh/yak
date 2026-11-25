import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { kept, moves, swipe } from './swipe.ts'

// A phone's page, 390 wide, with a menu from the left (`menu` its ways), the
// page's column over it, a panel from the right and their links, and a strip
// that scrolls sideways.
let page = (hash = '', html = '', menu = 'Layer-left') => {
  let { document } = parseHTML(`<html><body>
    <a href="#menu">Menu</a><a href="#aside">Reach</a>
    <nav id="menu" class="Layer ${menu}" data-swipe></nav>
    <main id="column" class="Layer_Cover"></main>
    <aside id="aside" class="Layer Layer-right" data-swipe></aside>
    <section id="app" class="Layer Layer-right"></section>
    <div id="strip"><p id="in">wide</p></div>${html}
  </body></html>`)
  let shown = (el: Element) => Object.assign(el, { getClientRects: () => [1] })
  for (let a of document.querySelectorAll('a')) shown(a)
  for (let el of document.querySelectorAll('.Layer')) {
    Object.assign(el, { getBoundingClientRect: () => ({ width: 300 }) })
  }
  let location = {
    hash,
    replace: (to: string) => location.hash = to == '#' ? '' : to,
  }
  let style = (el: Element) => ({
    overflowX: el.id == 'strip' ? 'auto' : 'visible',
  })
  let win = { innerWidth: 390, location, getComputedStyle: style }
  swipe(document, win as never)
  let touch = (type: string, x: number, y: number, t: number, on = 'body') => {
    let e = new document.defaultView!.Event(type, {
      bubbles: true,
      cancelable: true,
    })
    let p = [{ clientX: x, clientY: y }]
    Object.assign(e, {
      touches: type == 'touchend' ? [] : p,
      changedTouches: p,
    })
    Object.defineProperty(e, 'timeStamp', { value: t })
    document.querySelector(on)!.dispatchEvent(e)
    return e
  }
  // A finger from `x` to `to`, in steps 16 ms apart, moving `dy` down.
  let drag = (
    x: number,
    to: number,
    opt: { ms?: number; dy?: number; on?: string } = {},
  ) => {
    let steps = 6
    let ms = opt.ms ?? 300
    touch('touchstart', x, 400, 0, opt.on)
    let moved = Array.from({ length: steps }, (_, i) => {
      let k = (i + 1) / steps
      return touch(
        'touchmove',
        x + (to - x) * k,
        400 + (opt.dy ?? 0) * k,
        ms * k,
        opt.on,
      )
    })
    let [menu, column] = ['menu', 'column'].map((id) =>
      document.getElementById(id)!
    )
    let mid = [menu.style.translate, column.style.translate]
    touch('touchend', to, 400, ms, opt.on)
    return { moved, mid, menu, column }
  }
  return { document, location, drag }
}

test('a slow swipe right past the middle opens the menu, following the finger as it goes', () => {
  let p = page()
  let { moved, mid, menu } = p.drag(100, 300)
  assertEquals(p.location.hash, '#menu')
  assertEquals(mid, ['-100px 0', ''])
  assertEquals(moved.at(-1)!.defaultPrevented, true)
  assertEquals(menu.getAttribute('style') ?? '', '')
})

test('a menu under the page stays still, and the page over it follows the finger', () => {
  let p = page('', '', 'Layer-left Layer-under')
  let { mid, column } = p.drag(100, 300)
  assertEquals([p.location.hash, mid], ['#menu', ['', '200px 0']])
  assertEquals(column.getAttribute('style') ?? '', '')
  // Open, a swipe back carries the page back over it.
  assertEquals(p.drag(300, 220, { ms: 600 }).mid, ['', '220px 0'])
  assertEquals(p.location.hash, '#menu')
  p.drag(300, 100)
  assertEquals(p.location.hash, '')
})

test('a short slow swipe leaves the menu shut, and a short quick one opens it', () => {
  let p = page()
  p.drag(100, 160, { ms: 600 })
  assertEquals(p.location.hash, '')
  p.drag(100, 160, { ms: 90 })
  assertEquals(p.location.hash, '#menu')
})

test('a swipe left opens the panel from the right, and back closes it', () => {
  let p = page()
  p.drag(300, 100)
  assertEquals(p.location.hash, '#aside')
  p.drag(100, 300)
  assertEquals(p.location.hash, '')
})

test('a swipe left closes the open menu; one right leaves it open', () => {
  let p = page('#menu')
  p.drag(100, 300)
  assertEquals(p.location.hash, '#menu')
  p.drag(300, 100)
  assertEquals(p.location.hash, '')
})

test('what is not the gesture leaves the page as it is', () => {
  let cases: [string, Parameters<ReturnType<typeof page>['drag']>][] = [
    ['a mostly upright move scrolls', [100, 160, { dy: 200 }]],
    ['a touch at the screen edge is the browser’s', [10, 300, {}]],
    ['a field keeps its touches', [100, 300, { on: '#field' }]],
  ]
  for (let [said, args] of cases) {
    let p = page('', '<textarea id="field"></textarea>')
    let { moved } = p.drag(...args)
    assertEquals([said, p.location.hash, moved[5].defaultPrevented], [
      said,
      '',
      false,
    ])
  }
  // Another layer open over the page: no sidebar moves.
  let p = page('#app')
  p.drag(100, 300)
  assertEquals(p.location.hash, '#app')
})

test('a sidebar with no link shown to it does not open', () => {
  let p = page()
  for (let a of p.document.querySelectorAll('a')) {
    Object.assign(a, { getClientRects: () => [] })
  }
  p.drag(300, 100)
  assertEquals(p.location.hash, '')
})

test('a strip that scrolls sideways keeps the swipe until it reaches its end', () => {
  let { document } = parseHTML('<body><div id="strip"><p>x</p></div></body>')
  let strip = document.getElementById('strip')!
  let inner = strip.firstElementChild!
  Object.assign(strip, { scrollWidth: 800, clientWidth: 390, scrollLeft: 0 })
  let style = (el: Element) => ({ overflowX: el == strip ? 'auto' : 'visible' })
  let keeps = (left: number) => {
    strip.scrollLeft = left
    return [kept(inner, 50, style), kept(inner, -50, style)]
  }
  assertEquals([keeps(0), keeps(200), keeps(410)], [
    [false, true],
    [true, true],
    [true, false],
  ])
})

test('the open sidebar is the one a swipe toward its edge moves', () => {
  let s = (edge: 'left' | 'right', open = false) => ({ edge, open })
  assertEquals(moves([s('left'), s('right')], 10)?.edge, 'left')
  assertEquals(moves([s('left'), s('right')], -10)?.edge, 'right')
  assertEquals(moves([s('left')], -10), undefined)
  assertEquals(moves([s('left', true), s('right')], -10)?.edge, 'left')
  assertEquals(moves([s('left', true), s('right')], 10), undefined)
})

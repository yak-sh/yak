// The home page's sky (site/sky.tsx, public/sky.js) run over index.html. Its
// far scene is laid out one pixel to his unit from the window's corner, so a
// point in his units (x, y) is at (x + 3000, y + 800) in the window.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { page as home } from './site/mod.ts'
import { MOON, moon, PHASES, SINK, SUN } from './site/sky.tsx'

let html = home('index.html')
let code = await Deno.readTextFile(new URL('./public/sky.js', import.meta.url))

let sky = ({ dark = false, calm = false } = {}) => {
  let { document, window } = parseHTML(html)
  let on: Record<string, (e: unknown) => void> = {}
  let moved: string[] = []
  let rect = (r: Partial<DOMRect>) => () => r as DOMRect
  window.HTMLElement.prototype.getBoundingClientRect = rect({ top: 0, left: 0 })
  document.querySelector('.Hello_Yak')!.getBoundingClientRect = rect({
    left: 100,
    top: 150,
    width: 128,
    height: 128,
  })
  document.querySelector('.Sky_Far')!.getBoundingClientRect = rect({
    left: 0,
    top: 0,
    width: 6000,
  })
  window.Element.prototype.animate = function (this: Element) {
    moved.push(this.getAttribute('class') ?? '')
    return {} as Animation
  }
  let scope = {
    document,
    matchMedia: (q: string) => ({
      matches: q.includes('dark') ? dark : q.includes('reduce') ? calm : false,
    }),
    ResizeObserver: class {
      observe() {}
    },
    addEventListener: (type: string, f: (e: unknown) => void) => on[type] = f,
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: (f: () => void) => (f(), 0),
    performance,
    getSelection: () => ({ toString: () => '' }),
    scrollX: 0,
    scrollY: 0,
  }
  new Function('scope', `with (scope) {${code}}`)(scope)
  let el = (s: string) => document.querySelector(s)!
  // a touch at a point in his units, landing on `on` (the hero, by default)
  let touch = (x: number, y: number, target = el('.Hello')) =>
    on.click({ target, clientX: x + 3000, clientY: y + 800 })
  return { el, touch, moved, document }
}

test('the line he sits on is set where his tail touches it', () => {
  let { el } = sky()
  let feet = 150 + 128 * .89 - SINK
  assertEquals(
    (el('.Sky') as HTMLElement).style.getPropertyValue('--feet'),
    `${feet.toFixed(2)}px`,
  )
})

test('a touch on the moon turns it through its phases and back', () => {
  let { el, touch } = sky({ dark: true })
  let shapes = []
  for (let i = 0; i <= PHASES.length; i++) {
    shapes.push(el('.Sky_Moon').getAttribute('d'))
    touch(MOON.x + 10, MOON.y)
  }
  assertEquals(shapes, [...PHASES, PHASES[0]].map(moon))
})

test('a touch on words or a control is the page’s, not the sky’s', () => {
  let { el, touch } = sky({ dark: true })
  touch(MOON.x, MOON.y, el('.Hello_Kicker'))
  touch(MOON.x, MOON.y, el('.Hello_Ask button'))
  assertEquals(el('.Sky_Moon').getAttribute('d'), moon(PHASES[0]))
})

test('a touch on the sun sets it, and on the night sky shoots a star', () => {
  let day = sky()
  day.touch(SUN.x, SUN.y)
  assertEquals(day.moved, ['Sky_Sun', 'Sky_Glow'])
  let night = sky({ dark: true })
  night.touch(-200, -400)
  assertEquals(night.document.querySelectorAll('.Sky_Shoot').length, 2)
  assertEquals(night.moved, ['Sky_Shoot'])
})

test('for less motion nothing in the sky moves, and the moon still turns', () => {
  let day = sky({ calm: true })
  day.touch(SUN.x, SUN.y)
  let night = sky({ dark: true, calm: true })
  night.touch(-200, -400)
  night.touch(MOON.x, MOON.y)
  assertEquals([...day.moved, ...night.moved], [])
  assertEquals(night.el('.Sky_Moon').getAttribute('d'), moon(PHASES[1]))
  assert(night.document.querySelectorAll('.Sky_Shoot').length == 1)
})

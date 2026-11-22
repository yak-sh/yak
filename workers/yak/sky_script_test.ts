// The home page's sky (site/sky.tsx, public/sky.js) run over index.html, and
// over every other home page (variant.ts). Its far scene is laid
// out one pixel to his unit from the corner of a window 1440 by 860, so a
// point in his units (x, y) is at (x + 3000, y + 800) in the window. Its
// timers and frames wait to be run: `wait` lets every "now and then" come
// round once, and `watch` plays frames until none is asked for.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { homeStyle, skyScript } from '@yaks/platform/home/assets'
import { page as home } from './site/mod.ts'
import {
  DEPTH,
  HILLS,
  MOON,
  moon,
  PHASES,
  SINK,
  SUN,
} from '@yaks/platform/home/sky'

// The page Site keeps a home page's path in (site.ts `HOME`).
let file = (path: string) =>
  path == '/' ? 'index.html' : `${path.slice(1)}.html`
let code = await Deno.readTextFile(skyScript)
let style = await Deno.readTextFile(homeStyle)

test('the homepage foreground hill fades into the page color in both themes', () => {
  let { document } = parseHTML(home('index.html'))
  let foreground = document.querySelector('.Sky_Ground')!
  let fill = foreground.getAttribute('fill')!
  let last = document.querySelector(`${fill.slice(4, -1)} > stop:last-child`)!
  assertEquals(last.getAttribute('offset'), '1')
  let rule = new RegExp(
    `\\.${last.getAttribute('class')}\\s*\\{[^}]*stop-color:\\s*var\\(--bg\\)`,
  )
  assert(rule.test(style), 'the gradient ends at the theme’s page background')
})

let sky = ({ dark = false, calm = false, path = '/' } = {}) => {
  let { document, window } = parseHTML(home(file(path)))
  let on: Record<string, (e: unknown) => void> = {}
  let moved: string[] = []
  let timers: (() => void)[] = [], frames: ((now: number) => void)[] = []
  let now = 0
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
  let moonX = 1260, sunX = 720, lightY = 105
  let anchor = (name: string, x: number) => {
    let marker = document.querySelector(`[data-${name}-at]`)
    if (marker) {
      marker.getBoundingClientRect = () =>
        ({
          left: x,
          width: 0,
          top: lightY - 30 - scope.scrollY,
          height: 60,
        }) as DOMRect
    }
    return marker
  }
  let moonAt = anchor('moon', moonX)
  let sunAt = anchor('sun', sunX)
  // the Start Free button is 97px across, and 46px with its words stacked
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
    get(this: HTMLElement) {
      return this.dataset.narrow == null ? 97 : 46
    },
    configurable: true,
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
    setTimeout: (f: () => void) => timers.push(f),
    clearTimeout: () => {},
    requestAnimationFrame: (f: (now: number) => void) => frames.push(f),
    performance,
    getSelection: () => ({ toString: () => '' }),
    innerWidth: 1440,
    innerHeight: 860,
    scrollX: 0,
    scrollY: 0,
  }
  new Function('scope', `with (scope) {${code}}`)(scope)
  let el = (s: string) => document.querySelector(s)!
  let all = (s: string) => [...document.querySelectorAll(s)]
  let wait = () => timers.splice(0).forEach((f) => f())
  let watch = (most = 1e5) => {
    for (let n = 0; frames.length && n < most; n++) {
      frames.splice(0).forEach((f) => f(now += 50))
    }
  }
  // a touch at a point in his units, landing on `on` (the hero, by default)
  let touch = (x: number, y: number, target = el('.Hello')) =>
    on.click({ target, clientX: x + 3000, clientY: y + 800 })
  let touchMoon = (target?: Element) =>
    moonAt
      ? touch(moonX - 3000, lightY - 800 - scope.scrollY, target)
      : touch(MOON.x, MOON.y + (calm ? 0 : scope.scrollY * DEPTH.night), target)
  let touchSun = () =>
    sunAt
      ? touch(sunX - 3000, lightY - 800 - scope.scrollY)
      : touch(SUN.x, SUN.y + (calm ? 0 : scope.scrollY * DEPTH.dusk))
  // the wandering yak, sat down out in the margin at `left`, 72px across,
  // with the words beginning at `words`
  let sat = (left: number, words = 1440) => {
    let yak = document.createElement('div')
    yak.getBoundingClientRect = rect({ left, width: 72 })
    on.sat({ target: yak, detail: words })
    return yak.querySelector('.Sign') as HTMLElement
  }
  return {
    el,
    all,
    touch,
    touchMoon,
    touchSun,
    moved,
    wait,
    watch,
    sat,
    on,
    scope,
  }
}

test('the line he sits on is set where his tail touches it', () => {
  let { el } = sky()
  let feet = 150 + 128 * .89 - SINK
  assertEquals(
    (el('.Sky') as HTMLElement).style.getPropertyValue('--feet'),
    `${feet.toFixed(2)}px`,
  )
})

test('the home page and the describe page stand under the same sky', () => {
  for (let path of ['/', '/build']) {
    let { el } = sky({ path })
    assert((el('.Sky') as HTMLElement).style.getPropertyValue('--feet'), path)
  }
})

test('a touch on the moon turns it through its phases and back', () => {
  let { el, touchMoon } = sky({ dark: true })
  let shapes = []
  for (let i = 0; i <= PHASES.length; i++) {
    shapes.push(el('.Sky_Moon').getAttribute('d'))
    touchMoon()
  }
  assertEquals(shapes, [...PHASES, PHASES[0]].map(moon))
})

test('a touch on words or a control is the page’s, not the sky’s', () => {
  let { el, touchMoon } = sky({ dark: true })
  touchMoon(el('.Hello_Kicker'))
  touchMoon(el('.Hello form button'))
  assertEquals(el('.Sky_Moon').getAttribute('d'), moon(PHASES[0]))
})

test('a touch on the sun sets it', () => {
  let { touchSun, moved } = sky()
  touchSun()
  assertEquals(moved, ['Sky_Sun', 'Sky_Glow'])
})

test('a touch on the night sky sends a shooting star through it from beyond the window', () => {
  let { touch, all } = sky({ dark: true })
  for (let i = 0; i < 20; i++) touch(-2800 + 40 * i, -400)
  let stars = all('.Sky_Shoot')
  assertEquals(stars.length, 20)
  stars.forEach((star, i) => {
    let [x, y, turn] = star.getAttribute('transform')!.match(/-?[\d.]+/g)!
      .map(Number)
    assert(x < -3000 || x > -1560 || y < -800, `${x} ${y} is in the window`)
    // the touch is on its way: straight ahead of where it starts
    let ahead = Math.atan2(-400 - y, -2800 + 40 * i - x) * 180 / Math.PI
    assert(Math.abs(ahead - turn) < .2, `${ahead} is not ${turn}`)
  })
})

test('birds cross the dusk now and then, and a shooting star the night', () => {
  let day = sky()
  day.wait()
  day.watch(1)
  let birds = day.all('.Sky_Bird')
  assert(birds.length >= 1 && birds.length <= 7, `${birds.length} birds`)
  assertEquals(day.all('.Sky_Shoot').length, 0)
  // a glide holds its wings for up to 2.2s; in 3s they beat
  let shapes = new Set<string | null>()
  for (let n = 0; n < 60; n++) {
    day.watch(1), shapes.add(birds[0].getAttribute('d'))
  }
  assert(shapes.size > 1, 'its wings are where they were')
  day.watch()
  assertEquals(day.all('.Sky_Bird').length, 0)

  let night = sky({ dark: true })
  night.wait()
  night.watch()
  assertEquals(night.all('.Sky_Bird').length, 0)
  assertEquals(night.all('.Sky_Shoot').length, 1)
})

// How far each layer has sunk after a scroll of `y`, in his units (one to a
// pixel here), by its class.
let sinks = (y: number, calm = false, path = '/') => {
  let { all, on, scope } = sky({ calm, path })
  scope.scrollY = y
  on.scroll({})
  return Object.fromEntries(
    all('[data-depth]').map((el) => [
      el.getAttribute('class')!.split(' ').at(-1)!,
      Number((el as HTMLElement).style.getPropertyValue('--sink')),
    ]),
  )
}

test('as the page scrolls every layer goes up, the farther back the less', () => {
  for (let y of [0, 50, 150, 300, 600]) {
    let s = sinks(y)
    let up = (k: string) => y - s[k]
    let order = [
      'Sky_Deep',
      'Sky_Air',
      'Sky_Farthest',
      'Sky_Farther',
      'Sky_Near',
    ]
    assertEquals(s.Sky_Air, s.Sky_Day, `${y}`)
    order.forEach((k, i) => {
      assert(up(k) >= 0, `${k} goes down at ${y}`)
      let next = order[i + 1]
      if (y && next) assert(up(k) < up(next), `${k} outruns ${next} at ${y}`)
    })
    // the line he sits on goes up with the page, faster than any hill
    assert(!y || up('Sky_Near') < y)
  }
})

test('the hills on the build page rise over the sun as the page scrolls', () => {
  let hill = HILLS[0][1](SUN.x)
  let shows = (y: number) => {
    let s = sinks(y, false, '/build')
    let top = SUN.y - SUN.r + s.Sky_Day, over = hill + s.Sky_Farthest
    return Math.max(0, Math.min(2 * SUN.r, over - top)) / (2 * SUN.r)
  }
  let seen = [0, 30, 60, 100, 200].map(shows)
  assert(seen[0] > .6, `only ${seen[0]} of the sun shows at the top`)
  seen.slice(1).forEach((s, i) => assert(s < seen[i], `${seen}`))
  assertEquals(seen.at(-1), 0)
})

test('the dusk turns from blue to orange until the line reaches the top', () => {
  let feet = 150 + 128 * .89 - SINK
  let dusk = (y: number) => {
    let { el, on, scope } = sky()
    scope.scrollY = y
    on.scroll({})
    return Number((el('.Sky') as HTMLElement).style.getPropertyValue('--dusk'))
  }
  assertEquals([0, feet / 2, feet, 2 * feet].map(dusk), [0, .5, 1, 1])
})

test('the sun and the moon answer a touch where they now show', () => {
  let day = sky()
  day.scope.scrollY = 100
  day.on.scroll({})
  day.touchSun()
  assertEquals(day.moved, ['Sky_Sun', 'Sky_Glow'])
  for (let path of ['/', '/build']) {
    let night = sky({ dark: true, path })
    night.scope.scrollY = 300
    night.on.scroll({})
    night.touchMoon()
    assertEquals(night.el('.Sky_Moon').getAttribute('d'), moon(PHASES[1]))
  }
})

test('for less motion no layer sinks as the page scrolls', () => {
  assert(Object.values(sinks(300, true)).every((s) => s == 0))
})

test('for less motion nothing in the sky moves, and the moon still turns', () => {
  let day = sky({ calm: true })
  day.touchSun()
  day.wait()
  day.watch()
  let night = sky({ dark: true, calm: true })
  night.touch(-200, -400)
  night.touchMoon()
  night.wait()
  night.watch()
  assertEquals([...day.moved, ...night.moved], [])
  assertEquals(night.el('.Sky_Moon').getAttribute('d'), moon(PHASES[1]))
  assertEquals(night.all('.Sky_Shoot').length, 0)
  // a few birds hang in the dusk, and stay as they are
  let birds = day.all('.Sky_Bird').map((b) => b.outerHTML)
  assertEquals(birds.length, 4)
  day.watch()
  assertEquals(day.all('.Sky_Bird').map((b) => b.outerHTML), birds)
})

test('the button he holds up is slid along its post to stay in the window', () => {
  let { sat } = sky()
  let shift = (left: number) => sat(left).style.getPropertyValue('--shift')
  // centred over him it would start at 4.8 + 36 - 48.5 = -7.7, past the left
  assertEquals(shift(4.8), '15.7px')
  assertEquals(shift(200), '0.0px')
  // and end at 1400 + 36 + 48.5 = 1484.5, past the right
  assertEquals(shift(1400), '-52.5px')
})

test('the button he holds up keeps clear of the words beside him', () => {
  let { sat } = sky()
  let place = (left: number, words: number) => {
    let sign = sat(left, words)
    return [sign.style.getPropertyValue('--shift'), 'narrow' in sign.dataset]
  }
  // a wide margin: centred over him it ends at 160 + 36 + 48.5 = 244.5
  assertEquals(place(160, 300), ['0.0px', false])
  // it would end at 40 + 36 + 48.5 = 124.5, past the words at 120 - 8
  assertEquals(place(40, 120), ['-12.5px', false])
  // a margin of 100 has 84 for it: stacked, it is 46 and centred over him
  assertEquals(place(10, 100), ['0.0px', true])
  // stacked at 46 it would end at 20 + 36 + 23 = 79, past the words at 75 - 8
  assertEquals(place(20, 75), ['-12.0px', true])
})

test('he lowers the button as he gets up, and it is gone once he is home', () => {
  let { sat, on } = sky()
  let sign = sat(200)
  assertEquals(Object.keys(sign.dataset), ['out'])
  on.rise({})
  assertEquals(Object.keys(sign.dataset), ['away'])
  on.home({})
  assertEquals(Object.keys(sign.dataset), [])
})

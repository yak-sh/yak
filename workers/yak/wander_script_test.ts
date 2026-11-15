// The home page's yak (public/wander.js) run over index.html in a 1440 by
// 900 window, its frames stepped by hand. The page's words start where the
// column does; the hero's yak sits at the top of the page. Out of the hero
// his place is on the page, so a scroll alone never moves him. Out there his
// box asks for 56px of room above him, as style.css's does for his sign.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { parseHTML } from 'linkedom'
import { page as home } from './site/mod.ts'

let at = (path: string) => new URL(path, import.meta.url)
let html = home('index.html')
let code = await Deno.readTextFile(at('./public/wander.js'))

// `decode` is what the browser makes of decoding a strip ahead
let page = async (column = 144, decode = () => Promise.resolve()) => {
  let { document, window, Event, CustomEvent } = parseHTML(html)
  let env = {
    scrollY: 0,
    innerWidth: 1440,
    innerHeight: 900,
    now: 0,
    frames: [] as ((t: number) => void)[],
    on: {} as Record<string, () => void>,
    started: undefined as Promise<void> | undefined,
  }
  let slot = document.querySelector('[data-wander]')!
  Object.defineProperty(slot, 'offsetWidth', { value: 128 })
  slot.getBoundingClientRect = () =>
    ({
      left: 120,
      right: 248,
      top: 150 - env.scrollY,
      bottom: 278 - env.scrollY,
    }) as DOMRect
  // only his own pictures, out in the margin, take up room
  window.HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ) {
    return (this.closest('.Wander') && !slot.contains(this)
      ? { left: 21, right: 149, top: 0, bottom: 128, width: 128, height: 128 }
      : { width: 0 }) as DOMRect
  }
  window.HTMLImageElement.prototype.decode = decode
  Object.defineProperty(document, 'currentScript', {
    value: { src: 'https://yaks.app/wander.js' },
  })
  Object.assign(document, {
    // he starts once the fonts are in; `started` is how that went
    fonts: {
      ready: {
        then: (f: () => Promise<void>) =>
          env.started = Promise.resolve().then(f),
      },
    },
    createRange: () => ({
      selectNodeContents() {},
      getClientRects:
        () => [{ left: column, right: 900, width: 756, height: 20 }],
    }),
    createTreeWalker: () => {
      let left = 1
      let walker = {
        currentNode: null as unknown,
        nextNode: () => (walker.currentNode = left--
          ? document.querySelector('h1')!.firstChild
          : null),
      }
      return walker
    },
  })
  let scope = {
    document,
    Event,
    CustomEvent,
    window,
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({
      overflowX: 'visible',
      scrollMarginTop: '56px',
      scrollMarginBottom: '0px',
    }),
    performance: { now: () => env.now },
    requestAnimationFrame: (f: (t: number) => void) => env.frames.push(f),
    addEventListener: (type: string, f: () => void) => env.on[type] = f,
    scrollX: 0,
    get scrollY() {
      return env.scrollY
    },
    get innerWidth() {
      return env.innerWidth
    },
    get innerHeight() {
      return env.innerHeight
    },
  }
  new Function('scope', `with (scope) {${code}}`)(scope)
  // what he told the page, and `up` each time he leaves off sitting
  let told: string[] = [], heard = false
  let step = async (ms: number) => {
    for (let t = 0; t < ms; t += 16) {
      env.now += 16
      if (!heard && yak()) {
        heard = true
        for (let e of ['sat', 'rise', 'home']) {
          yak().addEventListener(e, () => told.push(e))
        }
      }
      let was = where()
      let frames = env.frames.splice(0)
      frames.forEach((f) => f(env.now))
      if (was.endsWith('sitting') && where().endsWith('moving')) told.push('up')
      await Promise.resolve()
    }
  }
  let scroll = async (
    y: number,
  ) => (env.scrollY = y, env.on.scroll?.(), await step(16))
  let yak = () => document.querySelector('.Wander') as HTMLElement
  // where he is: in the hero, or his place in the window and what he shows;
  // 'logo' when the page was never handed to him
  let where = () => {
    if (!yak()) return 'logo'
    let on = yak().querySelector('[data-on]')
    let showing = on?.matches('[data-idle]')
      ? 'sitting'
      : on
      ? 'moving'
      : 'hidden'
    return yak().parentElement == slot
      ? `home ${showing}`
      : `${yak().style.transform} ${showing}`
  }
  await step(64)
  let asked: string[] = []
  slot.querySelector('img[data-idle]')!.addEventListener(
    'idle',
    (e) => asked.push((e as CustomEvent).detail),
  )
  let click = () => yak().dispatchEvent(new Event('click'))
  let resize = async () => (env.on.resize(), await step(16))
  return {
    step,
    scroll,
    resize,
    where,
    click,
    asked,
    told,
    started: env.started!,
  }
}

test('the home page draws the yak as its logo, and loads what moves him', async () => {
  let { document } = parseHTML(html)
  let logo = document.querySelector('.Hello [data-wander] img[data-idle]')!
  assert(logo.getAttribute('srcset')!.includes('mascot/idle-rest-128-3x.webp'))
  for (let script of ['idle.js', 'wander.js']) {
    assert(document.querySelector(`script[src="${script}"]`))
  }
  for (let strip of ['down', 'up', 'plop']) {
    for (let d of ['-1x', '', '-3x']) {
      assert(
        (await Deno.stat(at(`./public/mascot/wander-${strip}-128${d}.webp`)))
          .isFile,
      )
    }
  }
})

test('once loaded he shows, sitting as the logo', async () => {
  let p = await page()
  assertEquals(p.where(), 'home sitting')
})

test('scrolled out of view, he scampers in just far enough to be in frame with room for what he holds, and there he stays', async () => {
  let p = await page()
  await p.scroll(1500)
  await p.step(500)
  assertEquals(p.where(), 'home sitting', 'he waits for the page to be still')
  await p.step(3000)
  assertEquals(p.where(), 'translate(21px, 1568px) sitting')
  await p.scroll(1400)
  await p.step(3000)
  assertEquals(
    p.where(),
    'translate(21px, 1568px) sitting',
    'in frame, he does not move',
  )
  await p.scroll(700)
  await p.step(3000)
  assertEquals(
    p.where(),
    'translate(21px, 1460px) sitting',
    'half out below, he comes back up just enough',
  )
})

test('scrolled back to the hero, he goes up into his place', async () => {
  let p = await page()
  await p.scroll(1500)
  await p.step(3000)
  await p.scroll(0)
  await p.step(1000)
  assert(p.where().endsWith('moving'), p.where())
  await p.step(8000)
  assertEquals(p.where(), 'home sitting')
})

test('he gets up, telling the page, before every walk, even carried far out of frame', async () => {
  let p = await page()
  await p.scroll(1500)
  await p.step(3000)
  await p.scroll(4000)
  await p.step(3000)
  assertEquals(p.told, ['up', 'sat', 'rise', 'up', 'sat'])
  await p.scroll(0)
  await p.step(9000)
  assertEquals(p.told.slice(5), ['rise', 'up', 'home'])
})

test('a resize while he sits in the margin measures the page without him', async () => {
  let p = await page()
  await p.scroll(1500)
  await p.step(3000)
  await p.resize()
  await p.step(3000)
  assertEquals(p.where(), 'translate(21px, 1568px) sitting')
})

test('with no margin to walk in, he stays the logo', async () => {
  let p = await page(40)
  await p.scroll(1500)
  await p.step(3000)
  assertEquals(p.where(), 'home sitting')
})

test('a click while he sits asks for his nose lick', async () => {
  let p = await page()
  p.click()
  assertEquals(p.asked, ['lick'])
})

let refused = () =>
  Promise.reject(new Error('The source image cannot be decoded.'))
let loaded = (width: number) =>
  function (this: HTMLImageElement) {
    Object.defineProperties(this, {
      complete: { value: true },
      naturalWidth: { value: width },
    })
    return refused()
  }

test('a strip the browser will not decode ahead, but loads, still moves him', async () => {
  let p = await page(144, loaded(768))
  await p.scroll(1500)
  await p.step(8000)
  assert(!p.where().startsWith('home'))
})

test('a strip that cannot load leaves him the logo, and says which', async () => {
  let p = await page(144, loaded(0))
  await assertRejects(
    () => p.started,
    Error,
    "The wandering yak's down strip did not load",
  )
  await p.scroll(1500)
  await p.step(3000)
  assertEquals(p.where(), 'logo')
})

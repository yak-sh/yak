// The home page's yak (public/wander.js) run over index.html in a 1440 by
// 900 window, its frames stepped by hand. The page's words start where the
// column does; the hero's yak sits at the top of the page.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'

let at = (path: string) => new URL(path, import.meta.url)
let html = await Deno.readTextFile(at('./public/index.html'))
let code = await Deno.readTextFile(at('./public/wander.js'))

let page = async (column = 144) => {
  let { document, window } = parseHTML(html)
  let env = {
    scrollY: 0,
    innerWidth: 1440,
    innerHeight: 900,
    now: 0,
    frames: [] as ((t: number) => void)[],
    on: {} as Record<string, () => void>,
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
  window.HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: 0 }) as DOMRect
  window.HTMLImageElement.prototype.decode = () => Promise.resolve()
  Object.assign(document, {
    fonts: { ready: Promise.resolve() },
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
    window,
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ overflowX: 'visible' }),
    performance: { now: () => env.now },
    requestAnimationFrame: (f: (t: number) => void) => env.frames.push(f),
    addEventListener: (type: string, f: () => void) => env.on[type] = f,
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
  let step = async (ms: number) => {
    for (let t = 0; t < ms; t += 16) {
      env.now += 16
      let frames = env.frames.splice(0)
      frames.forEach((f) => f(env.now))
      await Promise.resolve()
    }
  }
  let scroll = async (
    y: number,
  ) => (env.scrollY = y, env.on.scroll?.(), await step(16))
  let yak = () => document.querySelector('.Wander') as HTMLElement
  // where he is: in the hero, or his place in the window and what he shows
  let where = () =>
    yak().parentElement == slot
      ? 'home'
      : `${yak().style.transform} ${
        yak().querySelector('[data-on]')!.matches('[data-idle]')
          ? 'sitting'
          : 'moving'
      }`
  await step(64)
  return { step, scroll, where }
}

test('the home page draws the yak as its logo, and loads what moves him', async () => {
  let { document } = parseHTML(html)
  let logo = document.querySelector('.Hello [data-wander] img[data-idle]')!
  assert(logo.getAttribute('srcset')!.includes('/mascot/idle-rest-128-3x.webp'))
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

test('scrolled out of view, he scampers in just far enough to be in frame, and there he stays', async () => {
  let p = await page()
  await p.scroll(1500)
  await p.step(500)
  assertEquals(p.where(), 'home', 'he waits for the page to be still')
  await p.step(3000)
  assertEquals(p.where(), 'translate(21px, 12px) sitting')
  await p.scroll(1400)
  await p.step(3000)
  assertEquals(
    p.where(),
    'translate(21px, 112px) sitting',
    'in frame, he does not move',
  )
  await p.scroll(700)
  await p.step(3000)
  assertEquals(
    p.where(),
    'translate(21px, 760px) sitting',
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
  assertEquals(p.where(), 'home')
})

test('with no margin to walk in, he stays the logo', async () => {
  let p = await page(40)
  await p.scroll(1500)
  await p.step(3000)
  assertEquals(p.where(), 'home')
})

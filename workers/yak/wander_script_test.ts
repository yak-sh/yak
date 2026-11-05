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
  let { document, window, Event, CustomEvent } = parseHTML(html)
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
      width: 128,
      height: 128,
      top: 150 - env.scrollY,
      bottom: 278 - env.scrollY,
    }) as DOMRect
  window.HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: 0 }) as DOMRect
  window.HTMLImageElement.prototype.decode = () => Promise.resolve()
  Object.defineProperty(document, 'currentScript', {
    value: { src: 'https://yaks.app/wander.js' },
  })
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
    CustomEvent,
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
  let where = () => {
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
  // at home his box is the slot's
  let point = async (x: number, y: number) => {
    yak().getBoundingClientRect = slot.getBoundingClientRect
    env.on.pointermove({ clientX: x, clientY: y } as unknown as Event)
    await step(16)
  }
  // the eye frame he shows over his rest frame, or none
  let eyes = () => {
    let look = yak().querySelector('[data-look] img') as HTMLElement | null
    return look ? -parseInt(look.style.marginLeft) / 100 : 'none'
  }
  let asked: string[] = []
  slot.querySelector('img[data-idle]')!.addEventListener(
    'idle',
    (e) => asked.push((e as CustomEvent).detail),
  )
  let click = () => yak().dispatchEvent(new Event('click'))
  return { step, scroll, where, point, eyes, click, asked }
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

test('scrolled out of view, he scampers in just far enough to be in frame, and there he stays', async () => {
  let p = await page()
  await p.scroll(1500)
  await p.step(500)
  assertEquals(p.where(), 'home sitting', 'he waits for the page to be still')
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
  assertEquals(p.where(), 'home sitting')
})

test('with no margin to walk in, he stays the logo', async () => {
  let p = await page(40)
  await p.scroll(1500)
  await p.step(3000)
  assertEquals(p.where(), 'home sitting')
})

test('at rest his eyes follow the pointer', async () => {
  let p = await page()
  // his eyes are a third of the way down his 128 px frame, at x 184, y 193
  let looks = [
    [184, 193, 0],
    [184, 20, 1],
    [400, 20, 2],
    [400, 193, 3],
    [400, 600, 4],
    [184, 600, 5],
    [0, 600, 6],
    [0, 193, 7],
    [0, 0, 8],
    [190, 200, 0],
  ]
  for (let [x, y, frame] of looks) {
    await p.point(x, y)
    assertEquals(p.eyes(), frame, `${x}, ${y}`)
  }
})

test('a click while he sits asks for his nose lick', async () => {
  let p = await page()
  p.click()
  assertEquals(p.asked, ['lick'])
})

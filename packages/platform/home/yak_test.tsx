/** @jsxImportSource react */
// The hero yak's run (yak.js) clicked through on the home story, its words
// the keys they are read from.
import { lend, test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { parseHTML } from 'linkedom'
import { renderToString } from 'preact-render-to-string'
import { Story } from './mod.tsx'
import { RUN } from './parts.ts'
import { run } from './yak.js'
import type { Copy } from './words.ts'

let copy: Copy = {
  text: (key) => ({ children: [key] }),
  attr: (name, key) => ({ [name]: key }) as Record<typeof name, string>,
}
let markup = renderToString(
  <Story
    copy={copy}
    action='/start'
    yak={
      <div class='Hello_Yak' data-wander=''>
        <img class='Wander_Image' alt='' />
      </div>
    }
    plans={null}
  />,
)

// the home story, for someone who asks for less motion (`calm`) or not,
// with the person's own `words` in the idea box. The globals yak.js reads are
// lent until the page is disposed: left behind, the stubbed fetch and Event
// answered every later test in the runtime.
let page = ({ calm = true, words = '' } = {}) => {
  let { document, window } = parseHTML(
    `<!doctype html><html><body>${markup}</body></html>`,
  )
  let box = document.querySelector('#say') as HTMLTextAreaElement
  box.value = words
  let focused = 0
  box.focus = () => void focused++
  box.setSelectionRange = () => {}
  let fetched: string[] = []
  let backs = Object.entries({
    document,
    Image: window.Image,
    Event: window.Event,
    matchMedia: () => ({ matches: calm }),
    fetch: (
      url: string,
    ) => (fetched.push(url), Promise.resolve(new Response(new Blob(['webp'])))),
  }).map(([name, value]) => lend(name, value))
  run(document.body)
  let slot = document.querySelector('[data-wander]')!
  let says = slot.querySelector('.Home_YakSays') as HTMLElement
  let go = document.querySelector('#say')!.closest('form')!
    .querySelector('.Home_Build') as HTMLElement
  let click = () => {
    let e = new window.Event('click', { bubbles: true, cancelable: true })
    slot.querySelector('img')!.dispatchEvent(e)
    return { said: says.textContent, handled: e.defaultPrevented }
  }
  return {
    box,
    go,
    click,
    fetched,
    focused: () => focused,
    pose: () => slot.querySelector('.Home_YakPose') as HTMLImageElement,
    [Symbol.dispose]: () => backs.reverse().forEach((back) => back()),
  }
}

test('each click says the next line, the start step types into the box, and the last stays', () => {
  using p = page()
  let said = RUN.map(() => p.click().said)
  assertEquals(said, RUN.map((s) => `home.yak.${s.pose}`))
  assertEquals(p.box.value, 'home.yak.typing-type')
  assertEquals(p.focused(), 2)
  assertEquals(p.click(), { said: 'home.yak.flag', handled: true })
  assertEquals(p.focused(), 3)
  assertEquals(p.go.dataset.nudge, '')
  assertEquals(p.box.value, 'home.yak.typing-type')
})

test("a person's own words in the box are kept, and he points at the button", () => {
  using p = page({ words: 'a sign-up sheet' })
  RUN.slice(0, 4).forEach(() => p.click())
  assertEquals(p.click().said, 'home.yak.typing-had')
  assertEquals(p.box.value, 'a sign-up sheet')
  assertEquals(p.go.dataset.nudge, '')
})

test('with motion, each pose plays once over his seat and the words are typed a letter at a time', async () => {
  using time = new FakeTime()
  using p = page({ calm: false })
  RUN.slice(0, 4).forEach(() => p.click())
  await time.tickAsync(0)
  assertEquals(p.pose().dataset.on, '')
  await time.tickAsync(RUN[3].ms)
  assertEquals(p.pose().dataset.on, undefined)
  p.click()
  assertEquals(p.box.value, 'h')
  await time.tickAsync(45 * 'home.yak.typing-type'.length)
  assertEquals(p.box.value, 'home.yak.typing-type')
  assertEquals(
    p.fetched,
    RUN.map((s) => `/home-mascot/${s.pose}.webp`),
  )
})

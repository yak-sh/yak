// Wherever yaks.app says something is at work, the yak is there doing it, with
// the words beside it and a still frame for less motion (mascot.ts).
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import type { Bundle } from '@yaks/graph'
import { frame, talk } from './operator-view.ts'
import { shell } from './pages.ts'
import { desk } from './desk-pages.ts'
import { IDLE, idle, MOVES } from './mascot.ts'

let env = { APEX: 'yaks.fyi' }
let entry = (eid: string, seq: number, comps: Record<string, unknown>) =>
  ({ entity: { eid }, entry: { session: 's', seq }, ...comps }) as Bundle
let asked = [
  entry('in', 1, { content: { body: 'Any errors in cookbook?' } }),
  entry('ask', 2, { ask: { to: 'm', through: 'in' } }),
]
let calling = [
  ...asked,
  entry('call', 3, { call: { to: 'errors', args: { app: 'cookbook' } } }),
]
let names = () => ({
  doing: 'Checking cookbook for errors…',
  done: 'Checked cookbook for errors',
})

// The files a srcset names, checking each density is offered.
let srcset = (el: Element) => {
  let given = el.getAttribute('srcset')!.split(', ').map((c) => c.split(' '))
  assertEquals(given.map(([, d]) => d), ['1x', '2x', '3x'])
  return given.map(([f]) => f)
}

// Each yak on a page: its pose, its words, and the files it names.
let yaks = (html: string) =>
  [...parseHTML(`<main>${html}</main>`).document.querySelectorAll('.Loading')]
    .map((p) => {
      let pic = p.querySelector('.Loading_Mark')!
      let img = pic.querySelector('img')!
      let still = pic.querySelector('source')!
      assertEquals(img.getAttribute('alt'), '')
      assertEquals(
        still.getAttribute('media'),
        '(prefers-reduced-motion: reduce)',
      )
      return {
        pose: pic.getAttribute('data-pose'),
        words: p.textContent,
        files: [img.getAttribute('src')!, ...[img, still].flatMap(srcset)],
      }
    })

let served = async (path: string) => {
  let name = new URL(path, 'https://yaks.fyi').pathname
  let info = await Deno.stat(new URL(`./public${name}`, import.meta.url))
  assert(info.isFile, name)
}

test('what the Operator is doing is words a screen reader hears, and the yak beside the box shows it', () => {
  let task = { entity: { eid: 't' } } as Bundle
  let answered = [...asked, entry('out', 3, { output: { source: 'ask' } })]
  let crashed = [...asked, entry('x', 3, { exception: { message: 'down' } })]
  for (
    let [entries, doing, words] of [
      [asked, 'thinking', 'Thinking…'],
      [calling, 'tool', 'Checking cookbook for errors…'],
      [answered, 'done', ''],
      [crashed, 'failed', ''],
    ] as const
  ) {
    let thread = parseHTML(
      `<main>${talk(task, entries, names)}</main>`,
    )
      .document.querySelector('[data-task]')!
    assertEquals(
      [
        thread.getAttribute('data-doing'),
        thread.querySelector('[data-now]')!.textContent,
      ],
      [words ? doing : null, words],
    )
    assertEquals(thread.querySelector('img'), null)
    let { operator } = frame('t', entries, names, 0)
    assertEquals([operator.now, operator.doing], [words, doing])
  }
})

test("each thing the Operator does is one of the waiting yak's loops", () => {
  for (let { loop } of Object.values(MOVES)) assert(loop in IDLE, loop)
})

test('the builder waits with the yak at its keyboard', async () => {
  let page = await desk(
    { space: 'ada', apps: [], sell: 'none', view: 'new' },
    env,
  ).text()
  let [shown] = yaks(page)
  assertEquals([shown.pose, shown.words], ['typing', 'Building…'])
  for (let f of shown.files) {
    assert(f.startsWith('https://yaks.fyi/mascot/'), f)
    await served(f)
  }
})

test('the waiting yak is drawn at the size it shows, at every density', async () => {
  let page = await shell(
    env,
    'Message Elihu',
    null,
    200,
    idle('Composer_Figure'),
  )
    .text()
  let img = parseHTML(page).document.querySelector('img[data-idle]')!
  assertEquals(img.getAttribute('width'), '128')
  for (let f of [img.getAttribute('src')!, ...srcset(img)]) await served(f)
  for (let loop of Object.keys(IDLE)) {
    for (let f of srcset(img)) {
      await served(f.replace('/idle-rest-', `/idle-${loop}-`))
    }
  }
  assert(page.includes('/idle.js'))
})

// public/idle.js run over the waiting yak, its timers stepped by hand.
// `decoding` is how each loop's picture answers decode(), and `loads` whether
// the browser loads the loop at that object URL
let waiting = (
  still = false,
  decoding = () => Promise.resolve(),
  loads = (_url: string) => true,
) => {
  let { document, Event, CustomEvent, MutationObserver } = parseHTML(
    `<main>${idle('Composer_Figure')}</main>`,
  )
  let img = document.querySelector('img')!
  // each timer by its id; a cleared one is dropped
  let timers = new Map<number, [() => void, number]>()
  let ids = 0
  let fetched: string[] = []
  new Function(
    'document',
    'matchMedia',
    'fetch',
    'URL',
    'Image',
    'setTimeout',
    'clearTimeout',
    'MutationObserver',
    code,
  )(
    document,
    () => ({ matches: still }),
    (
      file: string,
    ) => (fetched.push(file),
      Promise.resolve({ ok: true, blob: () => Promise.resolve(file) })),
    {
      createObjectURL: (file: string) => `blob:${file}`,
      revokeObjectURL: () => {},
    },
    class {
      src = ''
      decode = decoding
      complete = true
      get naturalWidth() {
        return loads(this.src) ? 128 : 0
      }
    },
    (fn: () => void, ms: number) => (timers.set(++ids, [fn, ms]), ids),
    (id: number) => timers.delete(id),
    MutationObserver,
  )
  img.dispatchEvent(new Event('load'))
  let step = async () => {
    let [id, [fn, ms]] = timers.entries().next().value!
    timers.delete(id)
    fn()
    await new Promise((r) => setTimeout(r, 0))
    return ms
  }
  let shown = () => [img.getAttribute('src'), img.getAttribute('srcset')]
  let ask = (loop: string) =>
    img.dispatchEvent(new CustomEvent('idle', { detail: loop }))
  let doing = (loop?: string) =>
    loop
      ? img.setAttribute('data-doing', loop)
      : img.removeAttribute('data-doing')
  // a change to what he is doing is heard once the observer runs
  let settled = () => new Promise((r) => setTimeout(r, 0))
  return { step, shown, fetched, ask, doing, settled, rest: shown() }
}

let code = await Deno.readTextFile(
  new URL('./public/idle.js', import.meta.url),
)

test('he sits, then plays each of his loops once before any comes again', async () => {
  let yak = waiting()
  let played: string[] = []
  for (let i = 0; i < 12; i++) {
    let rested = await yak.step()
    assert(rested >= 5000 && rested <= 9000, `${rested}`)
    let [src, set] = yak.shown()
    let loop = src!.match(
      /^blob:\/mascot\/idle-(\w+)-128\.webp$/,
    )![1] as keyof typeof IDLE
    assertEquals(set, null)
    played.push(loop)
    assertEquals(await yak.step(), IDLE[loop])
    assertEquals(yak.shown(), yak.rest)
  }
  let all = Object.keys(IDLE).sort()
  assertEquals([played.slice(0, 6).sort(), played.slice(6).sort()], [all, all])
  for (let f of yak.fetched) await served(f)
})

test('asked for a loop, he plays it at once, or as the one playing ends, then waits again', async () => {
  let yak = waiting()
  yak.ask('lick')
  assertEquals(await yak.step(), 0)
  assertEquals(yak.shown(), ['blob:/mascot/idle-lick-128.webp', null])
  yak.ask('doze')
  assertEquals(await yak.step(), IDLE.lick, 'one loop at a time')
  assertEquals(await yak.step(), 0)
  assertEquals(yak.shown(), ['blob:/mascot/idle-doze-128.webp', null])
  assertEquals(await yak.step(), IDLE.doze)
  assertEquals(yak.shown(), yak.rest)
  let rested = await yak.step()
  assert(rested >= 5000 && rested <= 9000, `${rested}`)
})

test('while a page says what he is doing, he plays that loop over and over, then waits again', async () => {
  let yak = waiting()
  yak.doing('glance')
  await yak.settled()
  for (let i = 0; i < 3; i++) {
    assertEquals(await yak.step(), 0)
    assertEquals(yak.shown(), ['blob:/mascot/idle-glance-128.webp', null])
    assertEquals(await yak.step(), IDLE.glance)
  }
  yak.doing('ears')
  await yak.settled()
  assertEquals(await yak.step(), 0)
  assertEquals(yak.shown(), ['blob:/mascot/idle-ears-128.webp', null])
  yak.doing(undefined)
  await yak.settled()
  assertEquals(await yak.step(), IDLE.ears, 'the loop playing ends first')
  assertEquals(yak.shown(), yak.rest)
  let rested = await yak.step()
  assert(rested >= 5000 && rested <= 9000, `${rested}`)
})

test('a loop the browser will not decode ahead still plays once it loads', async () => {
  let yak = waiting(false, () => Promise.reject(new Error('Loading error.')))
  yak.ask('lick')
  await yak.step()
  assertEquals(yak.shown(), ['blob:/mascot/idle-lick-128.webp', null])
})

test('a loop the browser will not load, he leaves out and rests where he would play it', async () => {
  let yak = waiting(
    false,
    () => Promise.reject(new Error('Loading error.')),
    (url) => !url.includes('-tail-'),
  )
  yak.doing('tail')
  await yak.settled()
  await yak.step()
  assertEquals(yak.shown(), yak.rest)
  let played = new Set<string>()
  for (let i = 0; i < 12; i++) {
    let rested = await yak.step()
    assert(rested >= 5000 && rested <= 9000, `${rested}`)
    played.add(yak.shown()[0]!)
  }
  assertEquals(played, new Set([yak.rest[0]]), 'still, while it is asked for')
  yak.doing(undefined)
  await yak.settled()
  played.clear()
  for (let i = 0; i < 20; i++) {
    await yak.step()
    played.add(yak.shown()[0]!)
  }
  assert(!played.has('blob:/mascot/idle-tail-128.webp'))
  assertEquals(yak.fetched.filter((f) => f.includes('-tail-')).length, 1)
})

test('with less motion asked for, he stays at rest', async () => {
  let yak = waiting(true)
  for (let i = 0; i < 4; i++) {
    await yak.step()
    assertEquals(yak.shown(), yak.rest)
  }
  assertEquals(yak.fetched, [])
})

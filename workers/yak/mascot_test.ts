// Wherever yaks.app says something is at work, the yak is there doing it, with
// the words beside it and a still frame for less motion (mascot.ts).
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import type { Bundle } from '@yaks/graph'
import { frame, talk } from './operator-view.ts'
import { desk, shell } from './pages.ts'
import { IDLE, idle } from './mascot.ts'

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
  [...parseHTML(`<main>${html}</main>`).document.querySelectorAll('.Working')]
    .map((p) => {
      let pic = p.querySelector('.Working_Yak')!
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

test('the Operator at work is the yak doing what its words say', async () => {
  let task = { entity: { eid: 't' } } as Bundle
  for (
    let [entries, pose, words] of [
      [asked, 'thinking', 'Thinking…'],
      [calling, 'checking', 'Checking cookbook for errors…'],
    ] as const
  ) {
    let [shown] = yaks(talk(task, entries, names, [], '/chat', {}))
    assertEquals(shown.pose, pose)
    assertEquals(shown.words, words)
    for (let f of shown.files) await served(f)
    let { operator } = frame('t', entries, names, 0)
    assertEquals([operator.now, operator.pose], [words, pose])
  }
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
  let page = await shell(env, 'Message Elihu', null, 200, idle('Talk_Yak'))
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
let waiting = (still = false) => {
  let { document, Event } = parseHTML(`<main>${idle('Talk_Yak')}</main>`)
  let img = document.querySelector('img')!
  let timers: [() => void, number][] = []
  let fetched: string[] = []
  new Function(
    'document',
    'matchMedia',
    'fetch',
    'URL',
    'Image',
    'setTimeout',
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
      decode = () => Promise.resolve()
    },
    (fn: () => void, ms: number) => timers.push([fn, ms]),
  )
  img.dispatchEvent(new Event('load'))
  let step = async () => {
    let [fn, ms] = timers.shift()!
    fn()
    await new Promise((r) => setTimeout(r, 0))
    return ms
  }
  let shown = () => [img.getAttribute('src'), img.getAttribute('srcset')]
  return { step, shown, fetched, rest: shown() }
}

let code = await Deno.readTextFile(new URL('./public/idle.js', import.meta.url))

test('he sits, then plays each of his loops once before any comes again', async () => {
  let yak = waiting()
  let played: string[] = []
  for (let i = 0; i < 12; i++) {
    let rested = await yak.step()
    assert(rested >= 5000 && rested <= 9000, `${rested}`)
    let [src, set] = yak.shown()
    let loop = src!.match(/^blob:\/mascot\/idle-(\w+)-128\.webp$/)![1]
    assertEquals(set, null)
    played.push(loop)
    assertEquals(await yak.step(), IDLE[loop])
    assertEquals(yak.shown(), yak.rest)
  }
  let all = Object.keys(IDLE).sort()
  assertEquals([played.slice(0, 6).sort(), played.slice(6).sort()], [all, all])
  for (let f of yak.fetched) await served(f)
})

test('with less motion asked for, he stays at rest', async () => {
  let yak = waiting(true)
  for (let i = 0; i < 4; i++) {
    await yak.step()
    assertEquals(yak.shown(), yak.rest)
  }
  assertEquals(yak.fetched, [])
})

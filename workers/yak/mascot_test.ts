// Wherever yaks.app says something is at work, the yak is there doing it, with
// the words beside it and a still frame for less motion (mascot.ts).
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import type { Bundle } from '@yaks/graph'
import { frame, talk } from './operator-view.ts'
import { shell } from './pages.ts'
import { IDLE, Idle, MOVES } from './mascot.ts'
import { createElement as h } from 'react'
import { markup } from '@yaks/html'

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

let served = async (path: string) => {
  let name = new URL(path, 'https://yaks.fyi').pathname
  let info = await Deno.stat(new URL(`./public${name}`, import.meta.url))
  assert(info.isFile, name)
}

test('what the Operator is doing is a line under the conversation, and the yak beside the box shows it', () => {
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
        thread.querySelector('[data-now]')?.textContent ?? '',
        // the words under the conversation breathe while it works, as the
        // aside's Now does (operator-aside.ts `TurnNow`)
        !!thread.querySelector('.Transcript_Status .State-pulse'),
      ],
      [words ? doing : null, words, !!words],
    )
    assertEquals(thread.querySelector('img'), null)
    let { operator } = frame('t', entries, names, 0)
    assertEquals([operator.now, operator.doing], [words, doing])
  }
})

test("each thing the Operator does is one of the yak's poses, or one of his loops", async () => {
  for (let move of Object.values(MOVES)) {
    if ('loop' in move) assert(move.loop in IDLE, move.loop)
    else {
      for (
        let f of [
          '-1x',
          '',
          '-3x',
          '-still-1x',
          '-still',
          '-still-3x',
          '-128-1x',
          '-128',
          '-128-3x',
          '-still-128-1x',
          '-still-128',
          '-still-128-3x',
        ]
      ) {
        await served(`/mascot/${move.pose}${f}.webp`)
      }
    }
  }
})

test('the waiting yak is drawn at the size it shows, at every density', async () => {
  let page = await shell(
    env,
    'Message Elihu',
    null,
    200,
    markup(h(Idle, { className: 'Composer_Figure' })),
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
// `decoding` is how each loop's picture answers decode(), `loads` whether
// the browser loads the loop at that object URL, and `net` whether the
// network brings the file
let waiting = (
  still = false,
  decoding = () => Promise.resolve(),
  loads = (_url: string) => true,
  net = (_file: string) => true,
) => {
  let { document, Event, CustomEvent, MutationObserver } = parseHTML(
    `<main>${markup(h(Idle, { className: 'Composer_Figure' }))}</main>`,
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
      net(file)
        ? Promise.resolve({ ok: true, blob: () => Promise.resolve(file) })
        : Promise.reject(new TypeError('Failed to fetch'))),
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
  let posing = (pose?: string) =>
    pose
      ? img.setAttribute('data-pose', pose)
      : img.removeAttribute('data-pose')
  // a change to what he is doing is heard once the observer runs
  let settled = () => new Promise((r) => setTimeout(r, 0))
  return { step, shown, fetched, ask, posing, settled, timers, rest: shown() }
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

let pose = (name: string) => [
  `/mascot/${name}-128.webp`,
  ['-1x', '', '-3x'].map((f, i) => `/mascot/${name}-128${f}.webp ${i + 1}x`)
    .join(', '),
]

test('while a page names a pose, he holds it at once, cutting a loop short, then waits again', async () => {
  let yak = waiting()
  yak.ask('lick')
  await yak.step()
  yak.posing('thinking')
  await yak.settled()
  assertEquals(yak.shown(), pose('thinking'))
  assertEquals(yak.timers.size, 1, "only the cut loop's end")
  await yak.step()
  assertEquals(yak.shown(), pose('thinking'), 'the loop ending leaves the pose')
  assertEquals(yak.timers.size, 0)
  yak.posing('checking')
  await yak.settled()
  assertEquals(yak.shown(), pose('checking'))
  yak.posing(undefined)
  await yak.settled()
  assertEquals(yak.shown(), yak.rest)
  let rested = await yak.step()
  assert(rested >= 5000 && rested <= 9000, `${rested}`)
})

test('with less motion asked for, a pose is its still frame', async () => {
  let yak = waiting(true)
  yak.posing('thinking')
  await yak.settled()
  assertEquals(yak.shown(), pose('thinking-still'))
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
  yak.ask('tail')
  await yak.step()
  assertEquals(yak.shown(), yak.rest)
  let played = new Set<string>()
  for (let i = 0; i < 20; i++) {
    await yak.step()
    played.add(yak.shown()[0]!)
  }
  assert(!played.has('blob:/mascot/idle-tail-128.webp'))
  assertEquals(yak.fetched.filter((f) => f.includes('-tail-')).length, 1)
})

test('a loop the network drops, he rests through and fetches again when it next comes', async () => {
  let drops = 1
  let yak = waiting(
    false,
    undefined,
    undefined,
    (file) => !file.includes('-tail-') || !drops--,
  )
  yak.ask('tail')
  await yak.step()
  assertEquals(yak.shown(), yak.rest)
  yak.ask('tail')
  await yak.step()
  assertEquals(yak.shown(), ['blob:/mascot/idle-tail-128.webp', null])
  assertEquals(yak.fetched.filter((f) => f.includes('-tail-')).length, 2)
})

test('with less motion asked for, he stays at rest', async () => {
  let yak = waiting(true)
  for (let i = 0; i < 4; i++) {
    await yak.step()
    assertEquals(yak.shown(), yak.rest)
  }
  assertEquals(yak.fetched, [])
})

// Wherever yaks.app says something is at work, the yak is there doing it, with
// the words beside it and a still frame for less motion (mascot.ts).
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import type { Bundle } from '@yaks/graph'
import { frame, talk } from './operator-view.ts'
import { desk } from './pages.ts'

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
        files: [img.getAttribute('src')!, still.getAttribute('srcset')!],
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

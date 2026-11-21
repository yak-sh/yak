// A turn's words open the Reads whose titles they match in meaning, nearest
// first and two at most; words matching none open none, and a message signing
// someone up always opens the Read on signing up.
import { equal, test } from '@yaks/testing'
import type { Embedder } from '@yaks/embedding'
import { opened, SIGNING_UP } from './operator-reads.ts'

// Each text a point on the axes of the words it holds.
let AXES = ['voice', 'icon', 'text', 'app']
let embed: Embedder = {
  model: 'axes',
  embed: (t) => {
    let v = new Float32Array(AXES.map((a) => t.includes(a) ? 1 : 0))
    let n = Math.hypot(...v) || 1
    return v.map((x) => x / n)
  },
}
let read = (eid: string, title: string) => ({ entity: { eid }, doc: { title } })
let names = [
  read('voices', 'Your voice: what voices you can use'),
  read('icon', 'An app icon'),
  read(SIGNING_UP, 'Someone signing up'),
]
let eids = async (words: string, signup = false) =>
  (await opened(names, words, embed, signup)).map((b) => b.entity.eid)

test('words open the Read whose title they match, and none when they match none', async () => {
  equal(await eids('what voice can you use?'), ['voices'])
  equal(await eids('make the icon blue'), ['icon'])
  equal(await eids('hello there'), [])
})

test('a message signing someone up opens the Read on signing up', async () => {
  equal(await eids('hi, I am new here', true), [SIGNING_UP])
})

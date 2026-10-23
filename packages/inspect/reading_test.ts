// Code written for a storage, run in a view: it reads on as each of its
// reads is answered, says when it has read everything, and reads again when a
// write moves what it read.
import { h, render } from 'preact'
import { signal } from '@preact/signals'
import { parseHTML } from 'linkedom'
import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import type { Bundle, Io } from './host.ts'
import { type Reader, useReading } from './reading.ts'

let vocab = loadVocab({
  $defs: {
    step: {
      component: true,
      type: 'object',
      properties: { said: { type: 'string' }, next: { type: 'string' } },
    },
  },
})
let store = ram(vocab)
let step = (eid: string, said: string, next?: string): Bundle => ({
  entity: { eid },
  step: next ? { said, next } : { said },
})
store.tx((tx) => tx.patch([step('a', 'one', 'b'), step('b', 'two', 'c')]))
store.tx((tx) => tx.patch([step('c', 'three')]))

// A host answering each ask a turn after it is asked, as a server does, and
// again after every write.
let written = signal(0)
let io = {
  vocab,
  ask: (asks: Record<string, string>) => {
    written.value
    return Object.fromEntries(
      Object.entries(asks).map(([k, line]) => [k, {
        rows: store.read(line),
        ready: true,
      }]),
    )
  },
} as unknown as Io

// Follow the steps from `a`, saying each: a read that waits on the one before.
let walk = (r: Reader): string => {
  let said: string[] = []
  for (let at: string | undefined = 'a'; at;) {
    let [b] = r.get([at])
    let s = b?.step as { said?: string; next?: string } | undefined
    if (!s) break
    said.push(s.said ?? '')
    at = s.next
  }
  return said.join(' ')
}

let { document } = parseHTML('<html><body><main></main></body></html>')
let root = document.querySelector('main')!
let seen: { value: string; ready: boolean }[] = []
let Probe = () => {
  let got = useReading(io, walk)
  seen.push(got)
  return h('p', {}, got.value)
}
let turn = () => new Promise((go) => setTimeout(go, 0))
let g = globalThis as { document?: unknown }
g.document = document
render(h(Probe, {}), root)
for (let i = 0; i < 6; i++) await turn()
let first = seen.map((s) => s.value)
let settled = seen.at(-1)
store.tx((tx) => tx.patch([step('c', 'four')]))
written.value++
for (let i = 0; i < 3; i++) await turn()
let moved = seen.at(-1)
render(null, root)
delete g.document

test('a reading reads on as each read is answered, and says when it is done', () => {
  equal(first.slice(0, 4), ['', 'one', 'one two', 'one two three'])
  equal(settled, { value: 'one two three', ready: true })
  equal(seen.filter((s) => s.ready).length > 0, true)
  equal(seen.slice(0, 3).some((s) => s.ready), false)
})

test('a write to what it read reads again', () => {
  equal(moved, { value: 'one two four', ready: true })
})

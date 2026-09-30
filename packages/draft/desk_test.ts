// Interfaces typing into one person's drafts, each over its own line to one
// store: a write waits on its line until the line is flushed, as it would on
// a network, so two can type at once, or one while it is cut off.

import { test } from '@yaks/testing'
import { tick } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { client } from '@yaks/client'
import { type Bundle, mint } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { type Client, desk, draftDoc, drafts, type Stash } from './mod.ts'

let jo = mint()
let store = () =>
  client(loadVocab([draftDoc, docDoc]), [drafts()], { vault: false })

// A stash over a Map: two desks over one are two loads of one page.
let stash = (): Stash => {
  let items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  }
}

// An interface: a desk over its own line to the store.
let open = (s: Client, kept?: Stash) => {
  let queue: (() => void)[] = []
  let line: Client = {
    mutate: (change: Bundle[]) =>
      new Promise((ok, no) =>
        queue.push(() => {
          try {
            ok(s.mutate(change))
          } catch (err) {
            no(err)
          }
        })
      ),
    watch: s.watch,
  }
  let d = desk(line, { by: () => jo, stash: kept, pace: 0 })
  let flush = async () => {
    while (queue.length) {
      queue.shift()!()
      await tick()
    }
  }
  return Object.assign(d, { flush })
}

test('typing in one interface appears in another', async () => {
  let s = store()
  let [a, b] = [open(s), open(s)]
  a.type('T-5.comment', 'hello')
  assertEquals(a.text('T-5.comment'), 'hello', 'at once, before the store')
  await a.flush()
  assertEquals(b.text('T-5.comment'), 'hello')
})

test('two interfaces typing at once keep what both typed', async () => {
  let s = store()
  let [a, b] = [open(s), open(s)]
  a.type('p', 'ship it')
  await a.flush()
  a.type('p', 'ship it now')
  b.type('p', 'Ship it')
  await b.flush()
  await a.flush()
  await b.flush()
  assertEquals([a.text('p'), b.text('p')], ['Ship it now', 'Ship it now'])
})

test('what the store never took is back on the next load, and sent', async () => {
  let s = store()
  let kept = stash()
  let cut = open(s, kept) // its line never flushes: an outage, then a crash
  cut.type('p', 'half a thought')
  cut.close()
  let next = open(s, kept)
  assertEquals(next.text('p'), 'half a thought')
  await next.flush()
  assertEquals(open(s).text('p'), 'half a thought')
  assertEquals(kept.length, 0, 'the store has it now')
})

test('sending ends the draft everywhere, in one change with the send', async () => {
  let s = store()
  let [a, b] = [open(s), open(s)]
  a.type('p', 'looks good')
  await a.flush()
  let note = mint()
  a.spend('p', [{ entity: { eid: note }, doc: { body: a.text('p') } }])
  await a.flush()
  assertEquals([a.text('p'), b.text('p')], ['', ''])
  assertEquals(s.ent(note)?.doc, { body: 'looks good' })
})

test('a send the store refuses leaves its draft', async () => {
  let s = store()
  let a = open(s)
  a.type('p', 'looks good')
  await a.flush()
  a.spend('p', [{ entity: { eid: mint() }, nope: { body: 'looks good' } }])
  await a.flush()
  assertEquals([a.text('p'), open(s).text('p')], ['looks good', 'looks good'])
})

test('a discard keeps what another interface typed meanwhile', async () => {
  let s = store()
  let [a, b] = [open(s), open(s)]
  a.type('p', 'a')
  await a.flush()
  b.type('p', 'ab')
  a.spend('p')
  await a.flush()
  await b.flush()
  assertEquals([a.text('p'), b.text('p')], ['b', 'b'])
})

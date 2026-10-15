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
let al = mint()
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
    mutate: (bundles: Bundle[]) =>
      new Promise((ok, no) =>
        queue.push(() => {
          try {
            ok(s.mutate(bundles))
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

// A watched optimistic replica, with the receipt controlled independently.
// This is the same distinction an ordinary connected client makes.
let pending = (s: Client, kept: Stash) => {
  let receipts: { accept: () => void; reject: (err: Error) => void }[] = []
  let line: Client = {
    watch: s.watch,
    mutate: (bundles) => {
      let answer = s.mutate(bundles)
      return new Promise((resolve, reject) => {
        receipts.push({ accept: () => resolve(answer), reject })
      })
    },
  }
  let d = desk(line, { by: () => jo, stash: kept, pace: 0 })
  let answer = async (error?: Error) => {
    let next = receipts.shift()!
    if (error) next.reject(error)
    else next.accept()
    await Promise.resolve()
    await Promise.resolve()
  }
  return Object.assign(d, { answer })
}

// One store for the tests that need no fresh one, each in a place of its own.
let shared = store()
test('optimistic draft visibility keeps its stash until the receipt accepts', async () => {
  let kept = stash()
  let a = pending(shared, kept)
  try {
    a.type('pending', 'precious words')
    assertEquals(a.text('pending'), 'precious words')
    assertEquals(kept.length, 1)
    await a.answer()
    assertEquals(kept.length, 0)
  } finally {
    a.close()
  }
})

for (let failure of ['refused', 'unknown']) {
  test(`a ${failure} spend keeps its words through typing and reload`, async () => {
    let kept = stash()
    let a = pending(shared, kept)
    let place = `spend-${failure}`
    try {
      a.type(place, 'precious words')
      await a.answer()
      a.spend(place)
      assertEquals(a.text(place), '')
      assertEquals(
        JSON.parse(kept.getItem(`draft:${place}`)!).text,
        'precious words',
      )
      a.type(place, 'new words')
      await a.answer(new Error(failure))
      assertEquals(a.text(place), 'precious wordsnew words')
      a.close()
      let reloaded = desk({
        ...shared,
        mutate: () => new Promise(() => {}),
      }, {
        by: () => jo,
        stash: kept,
        pace: 0,
      })
      try {
        assertEquals(reloaded.text(place), 'precious wordsnew words')
      } finally {
        reloaded.close()
      }
    } finally {
      a.close()
    }
  })
}

test('a reload during a spend recovers the words hidden by optimistic clearing', async () => {
  let kept = stash()
  let a = pending(shared, kept)
  a.type('reload-spend', 'keep this')
  await a.answer()
  a.spend('reload-spend')
  a.close()
  let reloaded = desk({
    ...shared,
    mutate: () => new Promise(() => {}),
  }, {
    by: () => jo,
    stash: kept,
    pace: 0,
  })
  try {
    assertEquals(reloaded.text('reload-spend'), 'keep this')
  } finally {
    reloaded.close()
  }
})

test('a send without draft identity keeps recovery until its companion write accepts', async () => {
  let kept = stash()
  let response = Promise.withResolvers<Bundle[]>()
  let a = desk({
    mutate: () => response.promise,
    watch: () => ({ value: [], subscribe: () => () => {} }),
  }, { by: () => undefined, stash: kept, pace: 0 })
  try {
    a.type('anonymous', 'keep this')
    a.spend('anonymous', [{
      entity: { eid: 'sent' },
      doc: { body: 'keep this' },
    }])
    assertEquals(a.text('anonymous'), '')
    assertEquals(JSON.parse(kept.getItem('draft:anonymous')!).text, 'keep this')
    response.reject(new Error('response lost'))
    await Promise.resolve()
    await Promise.resolve()
    assertEquals(a.text('anonymous'), 'keep this')
    assertEquals(JSON.parse(kept.getItem('draft:anonymous')!).text, 'keep this')
  } finally {
    a.close()
  }
})

test('a closed desk receipt leaves a replacement desk recovery copy alone', async () => {
  let kept = stash()
  let old = pending(shared, kept)
  let place = 'replacement-desk'
  old.type(place, 'precious words')
  await old.answer()
  old.spend(place)
  old.close()
  let next = pending(shared, kept)
  try {
    next.type(place, 'precious words with newer typing')
    let copy = kept.getItem(`draft:${place}`)
    await old.answer()
    assertEquals(next.text(place), 'precious words with newer typing')
    assertEquals(kept.getItem(`draft:${place}`), copy)
  } finally {
    next.close()
  }
})

test('a closed desk receipt reconciles its unchanged recovery baseline', async () => {
  let kept = stash()
  let old = pending(shared, kept)
  let place = 'closed-baseline'
  old.type(place, 'first')
  old.type(place, 'newer')
  old.close()
  await old.answer()
  let copy = JSON.parse(kept.getItem(`draft:${place}`)!)
  assertEquals([copy.text, copy.over], ['newer', 'first'])
  let next = pending(shared, kept)
  try {
    assertEquals(next.text(place), 'newer')
  } finally {
    next.close()
  }
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

test('sending ends the draft everywhere, in one batch with the send', async () => {
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

// At the desk's own pace, what is typed just after a send waits its turn, as
// it does under a person's fingers.
test('restoring another draft source preserves subsequent typing', async () => {
  let d = desk(shared, { by: () => al }), place = 'restored'
  try {
    d.type(place, 'ship it')
    await Promise.resolve()
    assertEquals(await d.spend(place), true)
    d.type(place, 'next')
    d.restore(place, 'ship it')
    assertEquals(d.text(place).includes('ship it'), true)
    assertEquals(d.text(place).includes('next'), true)
  } finally {
    d.close()
  }
})

test('restoring a changed source replaces imported text and keeps other typing', () => {
  let d = desk({
    mutate: () => new Promise(() => {}),
    watch: () => ({
      value: [{
        entity: { eid: 'draft' },
        draft: { place: 'command', text: 'old title tail hosted', rev: 1 },
      }],
      subscribe: () => () => {},
    }),
  }, { by: () => jo, pace: 0 })
  try {
    d.type('command', 'old title tail hosted local')
    d.restore('command', 'new title tail', 'old title tail')
    assertEquals(d.text('command'), 'new title tail hosted local')
    d.restore('command', 'title tail', 'new title tail')
    assertEquals(d.text('command'), 'title tail hosted local')
  } finally {
    d.close()
  }
})

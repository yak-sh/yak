/// <reference lib="deno.ns" />
// Subscriptions over a reach: asked again whole when any member speaks, sent
// when the answer moved, beside a graph's own registry.
import { equal, test, tick } from '@yaks/testing'
import type { Bundle, Reduced } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { beside, reached, watched } from './reached.ts'
import { faults } from './refuse.ts'
import type { Frame } from './subs.ts'

let book = (eid: string) => ({ entity: { eid }, book: {} })

// A reach whose answer is whatever `answer` holds now, counting its reads,
// with one listener's frames; `answer` may also be a promise to hold a read.
let reach = (
  start: Bundle[] | Reduced | Error = [],
  signals?: (line: string) => boolean,
) => {
  let state = { answer: start as unknown, reads: 0 }
  let refused: string[] = []
  let subs = reached({
    read: async (line) => {
      state.reads++
      let now = await state.answer
      if (now instanceof Error) throw now
      return line == '.book.count'
        ? { count: (now as Bundle[]).length }
        : now as Bundle[]
    },
    refused: (_, line) => void refused.push(line),
    signals,
  })
  let frames: Frame[] = []
  let sink = (f: Frame) => void frames.push(f)
  return { subs, state, sink, refused, taken: () => frames.splice(0) }
}

test('a line is answered whole, again when a member speaks and the answer moved', async () => {
  let r = reach([book('dune')])
  r.subs.open(r.sink, 'all', '.book')
  r.subs.open(r.sink, 'n', '.book.count')
  await tick()
  equal(r.taken(), [
    { id: 'all', bundles: [book('dune')], reset: true },
    { id: 'n', count: 1 },
  ])
  r.subs.hear()
  await tick()
  equal([r.taken(), r.state.reads], [[], 4])
  r.state.answer = [book('dune'), book('emma')]
  r.subs.hear()
  await tick()
  equal(r.taken(), [
    { id: 'all', bundles: [book('dune'), book('emma')], reset: true },
    { id: 'n', count: 2 },
  ])
})

test('a change that names its lines asks only those again', async () => {
  let r = reach([book('dune')])
  r.subs.open(r.sink, 'all', '.book')
  r.subs.open(r.sink, 'n', '.book.count')
  await tick()
  r.taken()
  r.state.answer = [book('dune'), book('emma')]
  await r.subs.hear((line) => line == '.book.count')
  equal([r.taken(), r.state.reads], [[{ id: 'n', count: 2 }], 3])
})

test('an upstream change notifies signal watchers even when their rows stay the same', async () => {
  let r = reach([book('dune')], (line) => line == '.changed')
  r.subs.open(r.sink, 'signal', '.changed')
  r.subs.open(r.sink, 'data', '.book')
  await tick()
  r.taken()
  await r.subs.hear()
  equal(r.taken(), [{ id: 'signal', bundles: [book('dune')], reset: true }])
})

test('a change can refresh only selected readers of the same line', async () => {
  let r = reach([book('dune')])
  r.subs.open(r.sink, 'one', '.book', { person: 'ada' })
  r.subs.open(r.sink, 'two', '.book', { person: 'bea' })
  await tick()
  r.taken()
  r.state.answer = [book('emma')]
  await r.subs.hear((_, read) => read?.person == 'ada')
  equal([r.taken(), r.state.reads], [
    [{ id: 'one', bundles: [book('emma')], reset: true }],
    3,
  ])
})

test('a refusal is said under its id, told once, and the next change asks again', async () => {
  let r = reach(new Refused('unknown prop: .loan'))
  r.subs.open(r.sink, 'all', '.book')
  await tick()
  equal(r.taken(), [{
    id: 'all',
    refused: { error: 'Refused', message: 'unknown prop: .loan' },
  }])
  equal(r.refused, ['.book'])
  r.state.answer = [book('dune')]
  r.subs.hear()
  await tick()
  equal(r.taken(), [{ id: 'all', bundles: [book('dune')], reset: true }])
})

test('an answer a newer ask, a close or a drop overtook is never sent', async () => {
  let r = reach()
  let slow = Promise.withResolvers<Bundle[]>()
  r.state.answer = slow.promise
  r.subs.open(r.sink, 'all', '.book')
  r.state.answer = [book('emma')]
  r.subs.hear()
  slow.resolve([book('dune')])
  await tick()
  equal(r.taken(), [{ id: 'all', bundles: [book('emma')], reset: true }])
  r.subs.open(r.sink, 'one', '.book')
  r.subs.close(r.sink, 'one')
  r.subs.drop(r.sink)
  r.state.answer = [book('zed')]
  r.subs.hear()
  await tick()
  equal(r.taken(), [])
})

test('restored quiet, a line is held unasked until resumed', async () => {
  let r = reach([book('dune')])
  r.subs.restore([{ sink: r.sink, id: 'all', query: '.book' }], true)
  await tick()
  equal([r.taken(), r.state.reads, r.subs.watching()], [[], 0, true])
  r.subs.resume()
  await tick()
  equal(r.taken(), [{ id: 'all', bundles: [book('dune')], reset: true }])
})

test('beside a graph, a borrowed line is the reach’s and the rest the graph’s', async () => {
  let r = reach([book('loan')])
  let said: string[] = []
  let own = {
    open: (_: unknown, id: string) => void said.push(`open ${id}`),
    close: (_: unknown, id: string) => void said.push(`close ${id}`),
  } as unknown as Parameters<typeof beside>[0]
  let both = beside(own, r.subs, (line) => line.includes('loan'))
  both.open(r.sink, 'a', '.loan')
  both.open(r.sink, 'b', '.book')
  both.open(r.sink, 'a', '.doc')
  await tick()
  equal([said, r.state.reads, r.subs.watching()], [
    ['close a', 'open b', 'open a'],
    1,
    false,
  ])
})

test('a refusal relayed from the store a watch reads is said in its words, and a failure among them reported', () => {
  let heard: [string, string][] = []
  let off = faults((err) =>
    void heard.push([(err as Error).name, (err as Error).message])
  )
  try {
    let frames: Frame[] = []
    let relay = watched({
      watch: (line, sink) => {
        sink({
          refused: line == '.gone'
            ? { error: 'NotFound', message: 'No such line' }
            : { error: 'TypeError', message: 'x is not a function' },
        })
        return () => {}
      },
    })
    relay.open((f) => void frames.push(f), 'a', '.gone')
    relay.open((f) => void frames.push(f), 'b', '.broken')
    equal(frames, [
      { id: 'a', refused: { error: 'NotFound', message: 'No such line' } },
      {
        id: 'b',
        refused: { error: 'TypeError', message: 'x is not a function' },
      },
    ])
    equal(heard, [['TypeError', 'x is not a function']])
  } finally {
    off()
  }
})

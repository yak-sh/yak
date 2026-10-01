import { stub } from '@std/testing/mock'
import { equal, ok, test, throws } from '@yaks/testing'
import { channel, type Event, peek } from '@yaks/trace'
import { isPromise } from '@yaks/fp'
import { graph } from './graph.ts'
import { token } from './guard.ts'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { books, memory, slow } from './testing.ts'

for (let async of [false, true]) {
  test(`graph activity preserves legacy timing, rollback and hook args (${async})`, async () => {
    let audit: unknown
    let seen: Event[] = []
    let storage = memory()
    let g = graph({
      storage: async ? slow(storage) : storage,
      vocab: books,
      plugins: [{
        name: 'shop',
        hooks: {
          normalize: (b, _tx, err, context) => {
            equal(err, undefined)
            ok(context?.parent)
            equal(context?.graph, g)
            return b
          },
          audit: (b, _tx, err, context) => {
            audit = err
            ok(context?.parent)
            return b
          },
        },
      }],
    })
    let c = channel(g)
    let off = c.subscribe((e) => seen.push(e))
    let timings: string[] = []
    let out = g.apply(
      [{ entity: { eid: 'book-private' }, book: { pages: 7 } }],
      {
        check: true,
        parent: 'external',
        trace: (name, ms) => {
          timings.push(name)
          ok(ms >= 0)
        },
      },
    )
    equal(isPromise(out), async)
    await out
    equal(await g.get(['book-private']), [])
    ok(audit instanceof Error)
    let apply = ok(seen.find((e) => e.kind == 'apply' && e.stage == 'end'))
    equal(apply.parent, 'external')
    equal(apply.outcome, 'check')
    for (
      let name of ['normalize', 'prepare', 'mutate', 'transaction', 'audit']
    ) {
      ok(seen.some((e) => e.kind == 'phase' && e.name == name))
    }
    ok(timings.includes('transaction'))
    ok(!JSON.stringify(seen).includes('book-private'))
    off()
    equal(peek(g), undefined)
  })
}

test('query, rows and get expose counts without query text or row contents', async () => {
  let vocab = loadVocab([{
    $defs: {
      book: { component: true, properties: { title: { type: 'string' } } },
    },
  }])
  let g = graph({ vocab, storage: ram(vocab) })
  await g.apply([{
    entity: { eid: 'book-private' },
    book: { title: 'private' },
  }])
  let c = channel(g)
  let off = c.subscribe(() => {})
  await g.read('.book.title=private', { parent: 'request' })
  await g.rows('.book', { parent: 'request' })
  await g.get(['book-private'], ['book'], { parent: 'request' })
  let ends = c.history().filter((e) => e.stage == 'end')
  equal(ends.map((e) => [e.kind, e.name, e.parent, e.counts?.rows]), [
    ['query', 'read', 'request', 1],
    ['query', 'rows', 'request', 1],
    ['get', 'get', 'request', 1],
  ])
  let text = JSON.stringify(c.history())
  ok(!text.includes('private'))
  off()
})

test('only fired declared rules emit activity; refused batches cannot commit', async () => {
  let vocab = loadVocab([{
    $defs: {
      book: { component: true, properties: { pages: { type: 'number' } } },
      hefty: { component: true },
      mark_hefty: { rule: true, match: '$b .book.pages>5, +!hefty' },
    },
  }])
  let g = graph({ vocab, storage: ram(vocab) })
  let c = channel(g)
  let off = c.subscribe(() => {})
  await g.apply([{ entity: { eid: 'book' }, book: { pages: 7 } }])
  ok(c.history().some((e) => e.kind == 'rule' && e.name == 'mark_hefty'))
  await throws(() =>
    g.apply([{
      entity: { eid: 'book' },
      book: { pages: 9 },
      $was: { book: { pages: token(123) } },
    }])
  )
  equal((await g.get(['book']))[0].book, { pages: 7 })
  equal(
    c.history().findLast((e) => e.kind == 'apply' && e.stage == 'end')?.outcome,
    'refused',
  )
  off()
})

test('deferred work from a disconnected recording cannot appear on reconnect', async () => {
  let later: (() => unknown) | undefined
  let g = graph({
    vocab: books,
    storage: memory(),
    deferEffects: (run) => {
      later = run
    },
    plugins: [{ name: 'shop', hooks: { effect: (b) => b } }],
  })
  let c = channel(g)
  let off = c.subscribe(() => {})
  await g.apply([{ entity: { eid: 'book' }, book: { pages: 1 } }])
  off()
  let after: Event[] = []
  off = c.subscribe((e) => after.push(e))
  await later?.()
  equal(after, [])
  off()
})

for (let inactive of [false, true]) {
  test(`unobserved graph produces no activity calls, clocks or IDs (${inactive})`, () => {
    let g = graph({ vocab: books, storage: memory() })
    let c = inactive ? channel(g) : undefined
    let calls = 0
    let begin = c && stub(c, 'begin', () => {
      calls++
      return undefined
    })
    let instant = c && stub(c, 'instant', () => {
      calls++
      return undefined
    })
    let clocks = 0
    let ids = 0
    let clock = stub(performance, 'now', () => {
      clocks++
      return 0
    })
    let id = stub(crypto, 'randomUUID', () => {
      ids++
      return '00000000-0000-4000-8000-000000000000' as const
    })
    try {
      g.apply([{ entity: { eid: 'book' }, book: { pages: 1 } }])
      g.read({
        kind: 'and',
        clauses: [{
          kind: 'pred',
          path: ['book', 'pages'],
          op: '=',
          value: { kind: 'scalar', raw: '1' },
        }],
      })
      g.get(['book'])
      equal(calls, 0)
      equal(clocks, 0)
      equal(ids, 0)
      equal(c?.history() ?? [], [])
    } finally {
      clock.restore()
      id.restore()
      begin?.restore()
      instant?.restore()
    }
  })
}

for (let async of [false, true]) {
  test(`subscribing does not change legacy trace frequency (${async})`, async () => {
    let record = async (observed: boolean) => {
      let store = memory()
      let g = graph({
        vocab: books,
        storage: async ? slow(store) : store,
        plugins: [{
          name: 'shop',
          hooks: {
            normalize: (b) => async ? Promise.resolve(b) : b,
            effect: (b) => async ? Promise.resolve(b) : b,
            audit: (b) => async ? Promise.resolve(b) : b,
          },
        }],
      })
      let off = observed ? channel(g).subscribe(() => {}) : () => {}
      let phases: string[] = []
      try {
        for (let check of [false, true]) {
          await g.apply([
            { entity: { eid: 'book' }, book: { pages: 1 } },
          ], { check, trace: (name) => phases.push(name) })
        }
        return phases
      } finally {
        off()
      }
    }
    equal(await record(true), await record(false))
  })
}

test('synchronous reconnect during a root delivery cannot revive its phases', async () => {
  let g = graph({ vocab: books, storage: memory() })
  let c = channel(g)
  let seen: Event[] = []
  let stop = () => {}
  stop = c.subscribe((e) => {
    if (e.kind != 'apply' || e.stage != 'start') return
    stop()
    stop = c.subscribe((next) => seen.push(next))
  })
  await g.apply([{ entity: { eid: 'book' }, book: { pages: 1 } }])
  equal(seen, [])
  stop()
})

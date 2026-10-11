import { equal, test } from '@yaks/testing'
import { ram } from '@yaks/ram'
import { and, every, map, present, want } from '@yaks/query'
import { graph } from './graph.ts'
import { type Bundle, type Comp } from './bundle.ts'
import { token } from './guard.ts'
import type { Plugin } from './plugin.ts'
import { books } from './testing.ts'

let view: Plugin = {
  name: 'old-reader',
  reads: (opts) => opts.speaks?.shop == 0,
  ask: (_ctx, ast) =>
    map(ast, (c) => {
      if (c.kind == 'fields') {
        return {
          ...c,
          fields: c.fields.map((f) =>
            f.path.join('.') == 'review.stars'
              ? { ...f, path: ['book', 'pages'] }
              : f
          ),
        }
      }
      if (c.kind != 'pred') return c
      if (c.path.join('.') == 'review.stars') {
        return and(present('review'), { ...c, path: ['book', 'pages'] })
      }
      if (c.path.join('.') == 'review' && c.op == '?') {
        return and(c, want('book'))
      }
      return c
    }),
  answer: (_ctx, rows) =>
    rows.map((b) =>
      b.review && b.book
        ? { ...b, review: { stars: (b.book as { pages: number }).pages } }
        : b
    ),
}
let old = { speaks: { shop: 0 } }

test('read hooks rewrite storage predicates and get projections before answering', () => {
  let g = graph({ vocab: books, storage: ram(books), plugins: [view] })
  g.apply([
    { entity: { eid: 'r' }, review: {}, book: { pages: 12 } },
    { entity: { eid: 'b' }, book: { pages: 15 } },
  ])
  let rows = g.read('.review.stars>10', old)
  equal(rows, [{
    entity: { eid: 'r' },
    review: { stars: 12 },
    book: { pages: 12 },
  }])
  equal(g.get(['r'], ['review'], old), rows)
  equal(g.get(['r'], [], old), [{ entity: { eid: 'r' } }])
  equal(g.rows('.book.pages>10&.fields=review.stars', old), [
    { eid: 'r', 'review.stars': 12 },
    { eid: 'b', 'review.stars': 15 },
  ])
  equal(g.get(['r'], ['review']), [{ entity: { eid: 'r' }, review: {} }])
  equal(g.read('.review.stars>10'), [])
  equal(g.get(['r'], ['review'], { ...old, native: true }), [
    { entity: { eid: 'r' }, review: {} },
  ])
})

test('read hooks leave the current query text and result objects untouched', () => {
  let storage = ram(books)
  let q = '', calls = 0
  let g = graph({
    vocab: books,
    storage: {
      ...storage,
      read: (query, opts, comps) => {
        q = typeof query == 'string' ? query : 'AST'
        return storage.read(query, opts, comps)
      },
    },
    plugins: [{
      ...view,
      ask: () => {
        calls++
        throw Error('current ask')
      },
      answer: () => {
        calls++
        throw Error('current answer')
      },
    }],
  })
  let line = ' .book.pages>7  &?doc '
  equal(g.ask(line), line)
  equal(g.read(line), [])
  equal(q, line)
  equal(calls, 0)
  let rows = [{ entity: { eid: 'r' } }]
  equal(g.answer(rows) === rows, true)
})

let viewed = () => {
  let storage = ram(books)
  storage.tx((tx) =>
    tx.patch([{
      entity: { eid: 'r' },
      doc: { title: 'review' },
      book: { pages: 12 },
    }])
  )
  let reconstruct = (rows: Bundle[]) =>
    rows.map((b) => ({
      ...b,
      review: { stars: (b.book as Comp).pages },
    }))
  return graph({
    vocab: books,
    storage,
    plugins: [{
      name: 'caller-review',
      reads: (opts) => opts.speaks?.shop == 0,
      view: (_ctx, original) => ({
        original,
        query: and(present('book'), every()),
        vocab: books,
        answer: reconstruct,
      }),
      answer: () => {
        throw Error('a view must not reconstruct its caller values twice')
      },
    }, {
      name: 'read-token',
      answer: (_ctx, rows) =>
        rows.map((b) => {
          let review = b.review as Comp | undefined
          return review && Object.hasOwn(review, 'stars')
            ? { ...b, $was: { review: { stars: token(review.stars) } } }
            : b
        }),
    }],
  })
}

test('a caller view finishes query answers after reconstructing once', () => {
  let g = viewed()
  equal(g.read('.review', old), [{
    entity: { eid: 'r' },
    review: { stars: 12 },
    $was: { review: { stars: token(12) } },
  }])
  equal(g.read('.book', { ...old, native: true }), [{
    entity: { eid: 'r' },
    book: { pages: 12 },
  }])
})

test('a caller view finishes get answers after component selection', () => {
  let g = viewed()
  equal(g.get(['r'], ['review'], old), [{
    entity: { eid: 'r' },
    review: { stars: 12 },
    $was: { review: { stars: token(12) } },
  }])
  equal(g.get(['r'], ['doc'], old), [{
    entity: { eid: 'r' },
    doc: { title: 'review' },
  }])
})

test('a caller view finishes fields without witnessing unselected values', () => {
  let g = viewed()
  equal(g.read('.review&.fields=review.stars', old), [{
    entity: { eid: 'r' },
    review: { stars: 12 },
    $was: { review: { stars: token(12) } },
  }])
  equal(g.read('.review&.fields=doc.title', old), [{
    entity: { eid: 'r' },
    doc: { title: 'review' },
  }])
})

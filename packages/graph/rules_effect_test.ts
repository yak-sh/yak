// Effect rules observe a committed write against the whole entity it touched.
// A stored tag can select a job, but a stored trigger cannot repeat that job
// on an unrelated edit. Failures are reported without undoing the write or
// hiding it from the other observers.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { isPromise } from '@yaks/fp'
import { graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import type { Rule } from './rules.ts'
import { books, comp, memory } from './testing.ts'

let held = (one: ReturnType<typeof graph>, eid = 'b1') =>
  (one.get([eid]) as Bundle[])[0]

test('effect rules match stored tags and this batch’s writes', () => {
  let one = graph({ storage: memory(), vocab: books })
  one.apply([{
    entity: { eid: 'b1' },
    book: { pages: 412 },
    doc: { title: 'Dune' },
  }])
  let seen: unknown[] = []
  let now = '2026-09-07T04:20:00.000Z'
  one.use({
    name: 'shelf',
    rules: [{
      phase: 'effect',
      match: '.book, *bookmark, #Now, #Actor',
      run: ({ entity, book, Now, Actor }) => {
        assertEquals(comp(held(one), 'bookmark'), { of: 'b1' })
        seen.push([entity.eid, book, Now.at, Actor.by])
      },
    }],
  })
  let mark = () =>
    one.apply([{
      entity: { eid: 'b1' },
      bookmark: { of: 'b1' },
      $actor: { by: 'librarian' },
    }], { now })
  assert(!isPromise(mark()))
  assertEquals(seen, [['b1', { pages: 412 }, now, 'librarian']])
  one.apply([{ entity: { eid: 'b1' }, doc: { title: 'Dune, revised' } }])
  assertEquals(seen.length, 1)
  mark()
  assertEquals(seen.length, 2)
})

test('effect rules share a frozen view and resources, before hooks', () => {
  let one = graph({ storage: memory(), vocab: books })
  one.apply([{ entity: { eid: 'b1' }, book: { status: 'stocked' } }])
  let seen: string[] = []
  let calls = 0
  let shelves: unknown[] = []
  one.use({
    name: 'shelf',
    resources: { Shelf: () => ({ number: ++calls }) },
    rules: [
      {
        phase: 'effect',
        match: '*book, #Shelf',
        produce: { book: { status: 'sold' } },
        run: ({ Shelf }) => {
          shelves.push(Shelf)
          seen.push('sell')
        },
      },
      {
        phase: 'effect',
        match: '*book, book.status=stocked, #Shelf',
        run: ({ Shelf }) => {
          shelves.push(Shelf)
          seen.push('stocked')
        },
      },
    ],
    hooks: {
      effect: (b) => {
        seen.push('hook')
        assertEquals(comp(held(one), 'book').status, 'sold')
        return b
      },
    },
  })
  let out = one.apply([{ entity: { eid: 'b1' }, book: { pages: 412 } }])
  assert(!isPromise(out))
  assertEquals(seen, ['sell', 'stocked', 'hook'])
  assertEquals(calls, 1)
  assert(shelves[0] === shelves[1])
  assertEquals(comp(out[0], 'book'), { pages: 412, status: 'sold' })
})

test('each failing effect rule is reported and later observers still run', async () => {
  let seen: string[] = []
  let errors: unknown[] = []
  let broken = (run: Rule['run']): Rule => ({
    phase: 'effect',
    match: '*book',
    run,
  })
  let one = graph({
    storage: memory(),
    vocab: books,
    report: (e, at) => errors.push([String(e), at]),
    plugins: [{
      name: 'shelf',
      rules: [
        broken(() => {
          throw new Error('sync')
        }),
        broken(() => Promise.reject(new Error('async'))),
        broken(() => ({ doc: { title: 'outside the write set' } })),
        { phase: 'effect', match: '*book, #Missing' },
        broken(() => void seen.push('rule')),
      ],
      hooks: {
        effect: (b) => (seen.push('hook'), b),
        audit: (b) => (seen.push('audit'), b),
      },
    }],
  })
  let out = await one.apply([{ entity: { eid: 'b1' }, book: { pages: 412 } }])
  assertEquals(comp(out[0], 'book'), { pages: 412 })
  assertEquals(comp(held(one), 'book'), { pages: 412 })
  assertEquals(seen, ['rule', 'hook'])
  assertEquals(errors.length, 4)
  for (let [, at] of errors as [string, unknown][]) {
    assertEquals(at, { phase: 'effect', plugin: 'shelf' })
  }
})

test('effect rules do not observe checks or refused writes', () => {
  let seen: string[] = []
  let one = graph({
    storage: memory(),
    vocab: books,
    plugins: [{
      name: 'shelf',
      rules: [{
        phase: 'effect',
        match: '*book',
        run: () => void seen.push('rule'),
      }],
    }],
  })
  let bundles = [{ entity: { eid: 'b1' }, book: { pages: 412 } }]
  one.apply(bundles, { check: true })
  one.use({
    name: 'closed',
    hooks: {
      precondition: () => {
        throw new Error('closed')
      },
    },
  })
  assertThrows(() => one.apply(bundles), Error, 'closed')
  assertEquals(seen, [])
  assertEquals(held(one), undefined)
})

test('unrelated edits do not load stored views for checked effect rules', () => {
  let base = memory()
  let reads = 0
  let one = graph({
    vocab: books,
    storage: {
      ...base,
      get: (eids, names) => {
        if (eids.length) reads++
        return base.get(eids, names)
      },
      tx: (body) =>
        base.tx((tx) =>
          body({
            ...tx,
            get: (eids, names) => {
              if (eids.length) reads++
              return tx.get(eids, names)
            },
          })
        ),
    },
  })
  one.apply([{
    entity: { eid: 'b1' },
    book: { pages: 412 },
    doc: { title: 'Dune' },
  }])
  reads = 0
  one.apply([{ entity: { eid: 'b1' }, doc: { title: 'First edit' } }])
  let ordinary = reads
  let observed = 0
  one.use({
    name: 'shelf',
    rules: [{
      phase: 'effect',
      match: '.book, *bookmark',
      run: () => {
        observed++
      },
    }],
  })
  reads = 0
  one.apply([{ entity: { eid: 'b1' }, doc: { title: 'Second edit' } }])
  assertEquals(reads, ordinary)
  assertEquals(observed, 0)
  one.apply([{ entity: { eid: 'b1' }, bookmark: { of: 'b1' } }])
  assertEquals(observed, 1)
})

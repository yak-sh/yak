// Rules through a whole `apply()`: what a produce-only rule writes, that a
// gate makes a rule fire once ever, and that a rule which writes outside the
// write set it declared refuses the batch instead of writing.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import type { Plugin } from './plugin.ts'
import { isPromise } from './pipe.ts'
import { books, comp, memory } from './harness.ts'

let g = (plugins: Plugin[] = []) =>
  graph({ storage: memory(), vocab: books, plugins })

let sync = (out: Bundle[] | Promise<Bundle[]>): Bundle[] => {
  assert(!isPromise(out), 'apply() went async over a synchronous storage')
  return out
}

let held = (one: ReturnType<typeof g>, eid: string) =>
  (one.storage.tx((tx) => tx.get([eid])) as Bundle[])[0]

Deno.test('a produce-only rule writes its template into what it matched', () => {
  let one = g([{
    name: 'shelf',
    rules: [{
      name: 'shelve',
      phase: 'precondition',
      match: '.book, *book',
      produce: { book: { shelved: true } },
    }],
  }])
  sync(one.apply([
    { entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { pages: 412 } },
    { entity: { eid: 'p1' }, doc: { title: 'Chilton' } },
  ]))
  assertEquals(comp(held(one, 'b1'), 'book'), { pages: 412, shelved: true })
  // the bundle that never wore `book` was never matched
  assertEquals(held(one, 'p1').book, undefined)
})

Deno.test('a gate makes a rule fire once, across applies', () => {
  let fired: string[] = []
  let one = g([{
    name: 'once',
    rules: [{
      name: 'greet',
      phase: 'stamp',
      match: '.book, +!bookmark',
      run: (bound) => void fired.push(String(bound.entity.eid)),
    }],
  }])
  sync(one.apply([{ entity: { eid: 'b1' }, book: { pages: 412 } }]))
  assertEquals(fired, ['b1'])
  // the gate is written, so the second batch does not match at all
  assertEquals(comp(held(one, 'b1'), 'bookmark'), {})
  sync(one.apply([{ entity: { eid: 'b1' }, book: { pages: 500 } }]))
  assertEquals(fired, ['b1'])
})

Deno.test('a rule writing outside its *write set refuses the batch', () => {
  let one = g([{
    name: 'sloppy',
    rules: [{
      name: 'stray',
      phase: 'stamp',
      match: '.book, *doc',
      produce: { book: { status: 'sold' } },
    }],
  }])
  assertThrows(
    () => one.apply([{ entity: { eid: 'b1' }, book: { pages: 412 } }]),
    Error,
    'write set',
  )
  // refused inside the transaction, so nothing landed
  assertEquals(held(one, 'b1'), undefined)
})

// A rule declaring components this graph has never heard of is inert: that is
// how the core's own stamps ride along in a vocabulary with no `created`.
Deno.test('a rule about an unknown component is inert', () => {
  let one = g([{
    name: 'elsewhere',
    rules: [{
      phase: 'stamp',
      match: '.book, +!nonesuch',
      run: () => ({ book: { status: 'sold' } }),
    }],
  }])
  let out = sync(one.apply([{ entity: { eid: 'b1' }, book: { pages: 412 } }]))
  assertEquals(comp(out.find((b) => b.book), 'book'), { pages: 412 })
})

// Rules through a whole `apply()`: what a produce-only rule writes, that a
// gate makes a rule fire once ever, that a rule which writes outside the write
// set it declared refuses the batch instead of writing, and what the `#Name`
// resources of a tick are — one instant, read-only, and provided or refused.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import type { Phase, Plugin } from './plugin.ts'
import { type Rule, stands } from './rules.ts'
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
      // `*book` is the presence too: a rule writes what it matched
      match: '*book',
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
      match: '*doc',
      produce: { book: { status: 'sold' } },
    }],
  }])
  assertThrows(
    () =>
      one.apply([
        { entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { pages: 412 } },
      ]),
    Error,
    'write set',
  )
  // refused inside the transaction, so nothing landed
  assertEquals(held(one, 'b1'), undefined)
})

Deno.test('#Now is one instant for every rule in one apply', () => {
  let seen: string[] = []
  let clock = (phase: Phase): Rule => ({
    name: `clock at ${phase}`,
    phase,
    match: '.book, #Now',
    run: ({ Now }) => void seen.push(Now.at),
  })
  let one = g([{
    name: 'clocks',
    rules: [clock('precondition'), clock('stamp')],
  }])
  sync(one.apply([{ entity: { eid: 'b1' }, book: { pages: 412 } }]))
  assertEquals(seen.length, 2)
  assertEquals(new Set(seen).size, 1)
})

Deno.test('a rule writing a resource refuses the batch', () => {
  let one = g([{
    name: 'clockwork',
    rules: [{
      name: 'reset',
      phase: 'stamp',
      match: '*book, #Now',
      produce: { Now: { at: 'yesterday' } },
    }],
  }])
  assertThrows(
    () => one.apply([{ entity: { eid: 'b1' }, book: { pages: 412 } }]),
    Error,
    'read-only',
  )
})

// A resource is not vocabulary, so naming one nobody provides is a mistake
// where naming an unknown COMPONENT is inert — and it is one before the match,
// not only where a rule would have fired.
Deno.test('a rule naming a resource nobody provides is refused', () => {
  let one = g([{
    name: 'weathered',
    rules: [{
      name: 'rain',
      phase: 'stamp',
      match: '.book, #Weather',
      run: () => ({ book: { status: 'sold' } }),
    }],
  }])
  assertThrows(
    () => one.apply([{ entity: { eid: 'p1' }, doc: { title: 'Chilton' } }]),
    Error,
    'nothing provides',
  )
})

// A written resource is the value it stands for, and one standing for nothing
// writes nothing — which is why the trash mark needs no `by` if there is no
// actor to name.
// A resource is bound for `run`, never for the match: the grammar's values are
// values, so `created.at<Now.at` would compare against the literal text. It is
// refused rather than answered wrong.
Deno.test('a match comparing against a resource is refused', () => {
  let one = g([{
    name: 'stale',
    rules: [{
      name: 'expired',
      phase: 'stamp',
      match: '*book, created.at<Now.at, #Now',
      run: () => ({ book: { status: 'sold' } }),
    }],
  }])
  assertThrows(
    () => one.apply([{ entity: { eid: 'b1' }, book: { pages: 412 } }]),
    Error,
    'compares against #Now',
  )
})

Deno.test('a plugin provides a resource, capitalized', () => {
  let shop = (name: string): Plugin => ({
    name: 'shop',
    resources: { [name]: () => stands({ n: 3 }), Nobody: () => stands({}) },
    rules: [{
      name: 'aisled',
      phase: 'stamp',
      match: `*book, #${name}, #Nobody`,
      run: ({ Aisle, Nobody }) => ({
        book: { pages: Aisle, status: Nobody },
      }),
    }],
  })
  let one = g([shop('Aisle')])
  sync(one.apply([{ entity: { eid: 'b1' }, book: { pages: 412 } }]))
  assertEquals(comp(held(one, 'b1'), 'book'), { pages: 3 })
  // lowercase is a component's spelling, so it cannot be a resource's
  assertThrows(
    () =>
      g([shop('aisle')]).apply([{ entity: { eid: 'b1' }, book: { pages: 1 } }]),
    Error,
    'capitalized',
  )
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

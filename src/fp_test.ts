// The `///` doctests in fp.ts, run. They are the spec that came across with the
// port (https://yak.sh/lib/fp.js), and this repo has no doctest runner, so each
// one is asserted here in the order it appears there.
import { assertEquals } from '@std/assert'
import { pipe, push, set, update } from './fp.ts'

let inc = (x: number) => x + 1
let dec = (x: number) => x - 1

Deno.test('pipe: composes left to right', () => {
  assertEquals(pipe(inc, inc)(2), 4)
})

// Nil stops the composition — the semantics sql.ts's "exactness or nothing"
// contract rests on: a step that cannot answer returns nothing, and nothing
// downstream runs on it.
Deno.test('pipe: short-circuits on nil, at the door and mid-way', () => {
  assertEquals(pipe(inc, inc)(null), null)
  assertEquals(pipe(inc, inc)(undefined), undefined)
  assertEquals(
    pipe<number | null>((x) => x, () => null, (x) => (x ?? 0) + 1)(3),
    null,
  )
})

// A promise flows through untouched by the steps' own signatures, which is why
// the day the store seam goes async (D-33198) the composition costs nothing.
Deno.test('pipe: awaits transparently', async () => {
  assertEquals(await pipe(inc, inc)(Promise.resolve(2)), 4)
})

Deno.test('push: appends, and treats absent as empty', () => {
  assertEquals(push('c')(['a', 'b']), ['a', 'b', 'c'])
  assertEquals(push('a')(), ['a'])
})

Deno.test('set: merges over a copy', () => {
  let was = { a: 0, b: 2 }
  assertEquals(set<typeof was>({ a: 1 })(was), { a: 1, b: 2 })
  assertEquals(was, { a: 0, b: 2 })
})

Deno.test('update: maps the named fields through their functions', () => {
  assertEquals(update({ a: inc, b: dec })({ a: 1, b: 2 }), { a: 2, b: 1 })
})

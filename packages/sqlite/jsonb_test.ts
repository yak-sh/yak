// A property declared `object`, `array` or a union holds a JSON value: written
// as the value, stored as SQLite's binary JSON, read back as the value — never
// as a string. And a property declared `string` casts what it is sent, so the
// row, the answer to the write and every read agree.

import { assertEquals, assertThrows } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { kitchen, mem, PROJECTED, PROJECTED_ROW, RECIPE } from './testing.ts'
import { storage } from './mod.ts'
import { overlay } from './overlay.ts'

let recipe = (b: Bundle) => b.recipe as Record<string, unknown>

let kitchenStore = () => {
  let driver = mem()
  let s = storage(driver, kitchen)
  s.install()
  return { driver, s }
}

Deno.test('an object and an array are written and read back as values', () => {
  let { driver, s } = kitchenStore()
  s.tx((tx) => tx.patch([{ entity: { eid: 'r1' }, recipe: RECIPE }]))
  assertEquals(
    driver.query('select typeof(meta) as t from recipe', []),
    [{ t: 'blob' }],
  )
  assertEquals(recipe((s.read('.recipe') as Bundle[])[0]), RECIPE)
  assertEquals(recipe(s.tx((tx) => tx.get(['r1']))[0]), RECIPE)
  // A patch replaces a value whole, and a null clears it.
  s.tx((tx) =>
    tx.patch([{ entity: { eid: 'r1' }, recipe: { tags: [], meta: null } }])
  )
  assertEquals(recipe(s.tx((tx) => tx.get(['r1']))[0]), {
    ...RECIPE,
    tags: [],
    meta: null,
  })
})

Deno.test('a projected boolean reads back as true or false', () => {
  let { s } = kitchenStore()
  s.tx((tx) => tx.patch([{ entity: { eid: 'r1' }, recipe: RECIPE }]))
  assertEquals(s.rows(PROJECTED), [PROJECTED_ROW])
})

Deno.test('a string property holds what it was sent as a string', () => {
  let g = graph({ storage: kitchenStore().s, vocab: kitchen })
  let [out] = g.apply([{
    entity: { eid: 'r1' },
    recipe: { title: 5 },
  }]) as Bundle[]
  assertEquals(recipe(out).title, '5')
  assertEquals(recipe((g.read('.recipe') as Bundle[])[0]).title, '5')
  // A JSON property is held to the types it declares.
  assertThrows(
    () => g.apply([{ entity: { eid: 'r1' }, recipe: { tags: { a: 1 } } }]),
    Error,
    'recipe.tags is an array',
  )
})

Deno.test('a JSON property answers presence, and refuses a filter by name', () => {
  let { s } = kitchenStore()
  s.tx((tx) => tx.patch([{ entity: { eid: 'r1' }, recipe: RECIPE }]))
  assertEquals((s.read('.recipe.tags') as Bundle[]).length, 1)
  for (let q of ['.recipe.tags=sweet', '.order=recipe.meta', '.tally=tags']) {
    assertThrows(() => s.read(q), Error, 'holds a JSON value')
  }
})

Deno.test('a batch reads its JSON values the way the store will', () => {
  let { driver, s } = kitchenStore()
  s.tx((tx) => tx.patch([{ entity: { eid: 'r1' }, recipe: RECIPE }]))
  let over = overlay(driver, kitchen, [
    { entity: { eid: 'r1' }, recipe: { title: 'Pie' } },
    { entity: { eid: 'r2' }, recipe: { tags: ['new'] } },
  ])
  let rows = driver.query(
    `${over.with}select entity, (json(tags) || '') as tags, ` +
      `(json("any") || '') as "any" from ${
        over.at('recipe')
      } order by entity desc`,
    over.params,
  )
  assertEquals(rows.map((r) => [JSON.parse(String(r.tags)), r.any]), [
    [RECIPE.tags, JSON.stringify(RECIPE.any)],
    [['new'], null],
  ])
})

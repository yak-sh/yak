// A name outlives the batch: the sugar becomes a key, a seed written twice
// writes one recipe, a reference by name follows, and a clash is refused with
// the holder named.

import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { isPromise } from '@yaks/graph'
import { aliasEid } from './comp.ts'
import { cookbookGraph } from './harness.ts'

let sync = (out: Bundle[] | Promise<Bundle[]>): Bundle[] => {
  assert(!isPromise(out), 'apply() went async over an embedded database')
  return out
}

let read = (g: ReturnType<typeof cookbookGraph>, q: string) =>
  (g.read(q) as Bundle[]).map((b) => b.entity.eid).sort()

// The seed, as anybody would write it.
let CAKE = 'recipe:lemon-cakes'
let seed = (title: string): Bundle[] => [{
  entity: { eid: '$r' },
  alias: { name: CAKE },
  doc: { title },
  recipe: { serves: 8 },
}]

Deno.test('the sugar becomes a key entity of its own', () => {
  let g = cookbookGraph()
  let out = sync(g.apply(seed('Lemon cakes')))
  let r = out.find((b) => b.$alias == '$r')!.entity.eid
  assertEquals(read(g, '.alias!'), [aliasEid(CAKE)])
  assertEquals(
    (g.read(`.eid=${aliasEid(CAKE)}`) as Bundle[])[0].key,
    { of: r, value: CAKE },
  )
  // and the name is not a column on the recipe
  assertEquals((g.read(`.eid=${r}`) as Bundle[])[0].alias, undefined)
})

Deno.test('the same seed loaded twice writes one entity', () => {
  let g = cookbookGraph()
  let first = sync(g.apply(seed('Lemon cakes')))
  let r = first.find((b) => b.$alias == '$r')!.entity.eid
  let again = sync(g.apply(seed('Lemon cakes (better)')))
  assertEquals(again.find((b) => b.$alias == '$r')!.entity.eid, r)
  assertEquals(read(g, '.recipe!'), [r])
  assertEquals(
    ((g.read(`.eid=${r}`) as Bundle[])[0].doc as { title: string }).title,
    'Lemon cakes (better)',
  )
})

Deno.test('a reference by name resolves to the entity that holds it', () => {
  let g = cookbookGraph()
  let r = sync(g.apply(seed('Lemon cakes')))
    .find((b) => b.$alias == '$r')!.entity.eid
  sync(g.apply([{
    entity: { eid: 'c1' },
    comment: { target: CAKE },
    doc: { title: 'too sweet' },
  }]))
  assertEquals(
    ((g.read('.eid=c1') as Bundle[])[0].comment as { target: string }).target,
    r,
  )
})

Deno.test('a bundle addressed by name patches that entity', () => {
  let g = cookbookGraph()
  let r = sync(g.apply(seed('Lemon cakes')))
    .find((b) => b.$alias == '$r')!.entity.eid
  sync(g.apply([{ entity: { eid: CAKE }, recipe: { serves: 12 } }]))
  assertEquals(
    ((g.read(`.eid=${r}`) as Bundle[])[0].recipe as { serves: number }).serves,
    12,
  )
  assertEquals(read(g, '.recipe!'), [r])
})

Deno.test('an eid wins over a name that spells it', () => {
  let g = cookbookGraph()
  // an entity whose own id is a word, and a name pointing somewhere else
  sync(g.apply([
    { entity: { eid: 'cake' }, doc: { title: 'the entity' } },
    { entity: { eid: 'r2' }, alias: { name: 'cake' }, doc: { title: 'named' } },
  ]))
  sync(g.apply([{ entity: { eid: 'cake' }, doc: { title: 'patched' } }]))
  assertEquals(
    ((g.read('.eid=cake') as Bundle[])[0].doc as { title: string }).title,
    'patched',
  )
  assertEquals(
    ((g.read('.eid=r2') as Bundle[])[0].doc as { title: string }).title,
    'named',
  )
})

Deno.test('a second entity claiming a held name is refused, naming it', () => {
  let g = cookbookGraph()
  let r = sync(g.apply(seed('Lemon cakes')))
    .find((b) => b.$alias == '$r')!.entity.eid
  assertThrows(
    () =>
      sync(g.apply([{
        entity: { eid: 'r9' },
        alias: { name: CAKE },
        doc: { title: 'mine now' },
      }])),
    Error,
    `is ${r}'s`,
  )
})

Deno.test('a name is free again once the entity it named is deleted', () => {
  let g = cookbookGraph()
  let r = sync(g.apply(seed('Lemon cakes')))
    .find((b) => b.$alias == '$r')!.entity.eid
  sync(g.apply([{ entity: { eid: r }, $delete: true }]))
  assertEquals(read(g, '.alias!'), [])
  let next = sync(g.apply(seed('Lemon cakes, again')))
    .find((b) => b.$alias == '$r')!.entity.eid
  assert(next != r, 'a re-seeded name mints a new entity')
  assertEquals(read(g, '.recipe!'), [next])
})

Deno.test('a door reads ids and names through the same address()', () => {
  let g = cookbookGraph()
  let r = sync(g.apply(seed('Lemon cakes')))
    .find((b) => b.$alias == '$r')!.entity.eid
  let at = g.address([CAKE, r, 'nobody']) as Map<string, string>
  assertEquals([...at], [[CAKE, r]])
})

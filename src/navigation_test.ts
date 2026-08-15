import { assertEquals } from '@std/assert'
import { favoriteChange, favoriteLabel, navigationQuery } from './navigation.ts'
import type { Ent } from './types.ts'

let entity = (favorite = false): Ent => ({
  eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  num: 1,
  kind: 'task',
  ...(favorite
    ? { favorite: { eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }
    : {}),
  refs: [],
  kids: [],
})

Deno.test('navigation uses one facet query and reversible favorite write', () => {
  let plain = entity()
  let favorite = entity(true)
  assertEquals(navigationQuery, '.favorite!')
  assertEquals(favoriteLabel(plain), 'show in navigation')
  assertEquals(favoriteChange(plain), {
    eid: plain.eid,
    name: 'favorite',
    comp: {},
  })
  assertEquals(favoriteLabel(favorite), 'remove from navigation')
  assertEquals(favoriteChange(favorite), {
    eid: favorite.eid,
    name: 'favorite',
    comp: null,
  })
})

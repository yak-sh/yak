import { searchAt, searchPath } from './url.ts'
import { test } from '@yaks/testing'
import './testing.ts'
import { assertEquals } from '@std/assert'
import { reader } from './host_testing.ts'
import { vocab } from './types.ts'
import {
  configAt,
  destinationAt,
  destinations,
  favoriteChange,
  favoriteLabel,
  newAt,
  placeAt,
  places,
  schemaAt,
} from './navigation.ts'
import type { Ent } from './types.ts'

let actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
let entity = (favorite = false): Ent => ({
  eid: actor,
  num: 1,
  kind: 'task',
  ...(favorite ? { favorite: { eid: actor } } : {}),
  refs: [],
  kids: [],
})
let bugs = { key: 'bugs', name: 'Bugs', icon: 'bug', query: '.task' }

test('a favorite is a reversible facet write', () => {
  assertEquals(favoriteLabel(entity()), 'add to favorites')
  assertEquals(favoriteChange(entity()), {
    eid: actor,
    name: 'favorite',
    comp: {},
  })
  assertEquals(favoriteLabel(entity(true)), 'remove from favorites')
  assertEquals(favoriteChange(entity(true)).comp, null)
})

test('recent lists actual edits, independent of who opened a page', () => {
  let rows = [
    { entity: { eid: 'old' }, updated: { by: actor, at: '2026-10-01T00:00Z' } },
    { entity: { eid: 'new' }, updated: { by: actor, at: '2026-10-03T00:00Z' } },
    {
      entity: { eid: 'theirs' },
      updated: { by: 'b', at: '2026-10-04T00:00Z' },
    },
    { entity: { eid: 'kept' }, favorite: {} },
  ]
  let all = destinations(vocab, actor, '', [])
  let query = (key: string) => all.find((d) => d.key == key)?.query ?? ''
  let read = (key: string) => reader(rows)(query(key)).map((b) => b.entity.eid)
  assertEquals(read('recent'), ['theirs', 'new', 'old'])
  assertEquals(read('favorites'), ['kept'])
  assertEquals(
    destinations(vocab, undefined, '', []).some((d) => d.key == 'recent'),
    true,
  )
})

test('a package’s destination is listed once, has an address, and lights its line', () => {
  let all = destinations(vocab, actor, '.session', [bugs, { ...bugs }])
  assertEquals(all.filter((d) => d.key == 'bugs').length, 1)
  assertEquals(destinationAt('/?@page=bugs', all), bugs)
  assertEquals(destinationAt('/?bugs=1', all), undefined)
  assertEquals(destinationAt('/T-1?bugs', all), undefined)
  let lines = places({ name: 'Desk', icon: 'lamp', path: '/' }, all, true)
  assertEquals(placeAt('/?@page=bugs', lines)?.name, 'Bugs')
  assertEquals(placeAt('/', lines)?.name, 'Desk')
  assertEquals(placeAt('/?@page=map', lines)?.name, 'Schema')
  assertEquals(placeAt('/?q=bugs', lines), undefined)
  assertEquals(placeAt('/T-1', lines), undefined)
})

for (let word of ['new', 'map', 'config', 'favorites', 'bugs', 'sessions']) {
  test(`a query word ${word} cannot select a navigation page`, () => {
    let path = searchPath(word)
    assertEquals(searchAt(path), word)
    assertEquals(newAt(path), undefined)
    assertEquals(schemaAt(path), false)
    assertEquals(configAt(path), false)
    assertEquals(destinationAt(path, [bugs]), undefined)
  })
}

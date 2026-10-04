import { test } from '@yaks/testing'
import './testing.ts'
import { assertEquals } from '@std/assert'
import {
  favoriteChange,
  favoriteLabel,
  favoritePin,
  navigationQuery,
  navigationView,
} from './navigation.ts'
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

test('navigation uses one facet query and reversible favorite write', () => {
  let plain = entity()
  let favorite = entity(true)
  assertEquals(navigationQuery, '.favorite')
  assertEquals(navigationView, 'Navigation.List.Tile')
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
  assertEquals(favoritePin(plain), {
    eid: plain.eid,
    name: 'favorite',
    comp: {},
  })
  assertEquals(favoritePin(favorite), undefined)
})

import { reader } from './host_testing.ts'
import { vocab } from './types.ts'
import { sidebarMatches, sidebarQueries } from './navigation.ts'

test('sidebar recent reads newest personal opens, sessions keep person-started rows', () => {
  let actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let rows = [
    {
      entity: { eid: 'old' },
      doc: { title: 'Old' },
      opened: { by: actor, at: '2026-10-01T00:00:00Z' },
    },
    {
      entity: { eid: 'new' },
      doc: { title: 'New' },
      opened: { by: actor, at: '2026-10-03T00:00:00Z' },
    },
    {
      entity: { eid: 'other' },
      opened: {
        by: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        at: '2026-10-04T00:00:00Z',
      },
    },
    {
      entity: { eid: 'mine' },
      session: { operator: true },
      created: { by: actor, at: '2026-10-02T00:00:00Z' },
    },
    {
      entity: { eid: 'not-mine' },
      session: {},
      created: { by: 'other', at: '2026-10-03T00:00:00Z' },
    },
  ]
  let query = sidebarQueries(vocab, actor)
  assertEquals(reader(rows)(query.recent).map((b) => b.entity.eid), [
    'new',
    'old',
  ])
  assertEquals(reader(rows)(query.sessions).map((b) => b.entity.eid), ['mine'])
  assertEquals(
    sidebarMatches(
      { ...entity(), board: { eid: 'x', query: '.task' } },
      'TASK',
    ),
    true,
  )
  assertEquals(sidebarMatches(entity(), 'TASK'), false)
})

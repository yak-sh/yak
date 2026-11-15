// Whom a preview link's ticket still admits, as whom, and which draft it
// shows.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { admits, type Holding, shows, type Ticket, viewer } from './preview.ts'

let ticket: Ticket = {
  app: 'a1',
  space: 's1',
  person: 'ada',
  of: 'd1',
  exp: 100,
}
let holding: Holding = {
  space: { eid: 's1', slug: 'ada', trashed: null },
  app: { slug: 'menu', followed: null, trashed: null },
  role: 'editor',
}
let at = { host: 'ada.yaks.app', app: 'menu', now: 99_999 }

test('a ticket opens its link only where it was sealed, for a writer, until it expires', () => {
  let cases: [string, Partial<Ticket>, Partial<Holding>, object, boolean][] = [
    ['as sealed', {}, {}, {}, true],
    ['expired', {}, {}, { now: 100_000 }, false],
    ['sealed with no expiry', { exp: undefined }, {}, {}, false],
    ['another space', { space: 's2' }, {}, {}, false],
    ['another host', {}, {}, { host: 'bob.yaks.app' }, false],
    ['another slug', {}, {}, { app: 'soup' }, false],
    ['a reader', {}, { role: 'viewer' }, {}, false],
    ['nobody there', {}, { role: null }, {}, false],
    ['app trashed', {}, { app: { ...holding.app, trashed: {} } }, {}, false],
    [
      'space trashed',
      {},
      { space: { ...holding.space, trashed: {} } },
      {},
      false,
    ],
    ['naming no draft', { of: undefined }, {}, {}, false],
    ['screen still paired', { screen: 'tv' }, {}, { paired: 'ada' }, true],
    ['screen unpaired', { screen: 'tv' }, {}, { paired: null }, false],
    [
      'screen paired to another',
      { screen: 'tv' },
      {},
      { paired: 'bob' },
      false,
    ],
  ]
  for (let [name, t, h, a, want] of cases) {
    assertEquals(
      admits({ ...ticket, ...t }, { ...holding, ...h }, { ...at, ...a }),
      want,
      name,
    )
  }
})

test('a link reads as its person, a TV or a closed draft as a viewer, a worker as its grant', () => {
  let as = { person: 'ada', role: 'owner' as const, via: 'a1' }
  assertEquals(viewer(ticket, 'owner', null, true), as)
  assertEquals(viewer(ticket, 'owner', null, false), { ...as, role: 'viewer' })
  assertEquals(viewer({ ...ticket, screen: 'tv' }, 'owner', null, true), {
    person: 'ada',
    role: 'viewer',
    via: 'tv',
  })
  let grant = { person: 'ada', role: 'viewer' as const, via: 'w' }
  assertEquals(viewer(ticket, 'owner', grant, true), {
    ...grant,
    role: 'owner',
  })
  assertEquals(viewer(ticket, 'owner', grant, false), grant)
  let other = { person: 'bob', role: 'viewer' as const }
  assertEquals(viewer(ticket, 'owner', other, true), other)
})

test('a ticket shows the draft it names, none once that draft is closed', () => {
  let drafts = [{ eid: 'd1', by: 'ada' }, { eid: 'd0', by: null }]
  assertEquals(shows(ticket, drafts)?.eid, 'd1')
  assertEquals(shows({ ...ticket, of: 'gone' }, drafts), null)
})

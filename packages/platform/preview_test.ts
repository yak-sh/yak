// Whom a preview link's ticket still admits, as whom, and which draft it
// shows.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { admits, type Holding, shows, type Ticket, viewer } from './preview.ts'

let ticket: Ticket = { app: 'a1', space: 's1', person: 'ada', of: 'd1' }
let holding: Holding = {
  space: { eid: 's1', slug: 'ada', trashed: null },
  app: { slug: 'menu', followed: null, trashed: null },
  role: 'editor',
}
let at = { host: 'ada.yaks.app', app: 'menu' }

test('a ticket opens its link only where it was sealed, for a writer', () => {
  let cases: [string, Partial<Ticket>, Partial<Holding>, object, boolean][] = [
    ['as sealed', {}, {}, {}, true],
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
    [
      "legacy, the app's link",
      { of: undefined, link: 'l1' },
      { app: { ...holding.app, followed: 'l1' } },
      {},
      true,
    ],
    ['legacy, moved on', { of: undefined, link: 'l1' }, {}, {}, false],
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

test('a link reads as its person, a TV as a viewer, a worker as its grant', () => {
  assertEquals(viewer(ticket, 'owner', null), {
    person: 'ada',
    role: 'owner',
    via: 'a1',
  })
  assertEquals(viewer({ ...ticket, screen: 'tv' }, 'owner', null), {
    person: 'ada',
    role: 'viewer',
    via: 'tv',
  })
  let grant = { person: 'ada', role: 'viewer' as const, via: 'w' }
  assertEquals(viewer(ticket, 'owner', grant), { ...grant, role: 'owner' })
  let other = { person: 'bob', role: 'viewer' as const }
  assertEquals(viewer(ticket, 'owner', other), other)
})

test('a ticket shows the draft it names, else the one nobody holds', () => {
  let drafts = [{ eid: 'd1', by: 'ada' }, { eid: 'd0', by: null }]
  assertEquals(shows(ticket, drafts)?.eid, 'd1')
  assertEquals(shows({ ...ticket, of: 'gone' }, drafts), null)
  assertEquals(shows({ ...ticket, of: undefined }, drafts)?.eid, 'd0')
})

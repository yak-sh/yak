import { equal, ok, test, until } from '@yaks/testing'
import type { Friends } from '@yaks/platform/friends-at'
import { withDom } from './dom_fixture.ts'
import { memberOf } from './party-state.ts'
import { partybox } from './partybox.ts'
import type { parties } from './party.ts'
import type { Frame } from './play.ts'
import type { Bundle } from './net.ts'
import { seedItems } from './items_fixture.ts'
import { ITEMS } from './items.ts'

seedItems()

test('party details show live character stats and gear, then clear them when away', () =>
  withDom((_, body) => {
    let row: Bundle = {
      entity: { eid: 'ada' },
      player: {},
      position: { level: 'mossvale', x: 12, z: 18, at: 1000 },
      vitals: { hp: 35, max: 80, lvl: 7 },
      gear: { main: 'sword1', off: 'shield1' },
      motion: { gait: 'idle' },
      fight: { foe: 'wolf' },
    }
    let members = [memberOf(row, 'Ada <hero>', 1000)]
    let party = {
      canJoin: true,
      invites: [],
      group: 'group',
      get members() {
        return members
      },
      location: () => 'Mossvale · 12 m N',
      friends: { kind: 'friends', friends: [] },
      readFriends: () => Promise.resolve(),
    } as unknown as ReturnType<typeof parties>
    let view = partybox(
      { body, open: true, show() {}, close() {}, toggle() {}, head() {} },
      party,
      () => {},
    )
    let frame = { body: { x: 0, z: 0 } } as Frame
    view.paint(frame)
    body.querySelector<HTMLElement>('[data-select="member:ada"]')!.click()
    let detail = body.querySelector('.Split_Content')!
    let text = () => detail.textContent!
    ok(text().includes('Ada <hero>'))
    ok(text().includes('Level 7'))
    let health = () => detail.querySelector('[role=meter]')
    equal(health()?.getAttribute('aria-valuenow'), '35')
    equal(health()?.getAttribute('aria-valuemax'), '80')
    ok(text().includes('In combat'))
    ok(text().includes(ITEMS.sword1.name))
    ok(text().includes(ITEMS.shield1.name))
    ok(text().includes('HeadEmpty'))
    row.vitals = { hp: 0, max: 80, lvl: 7 }
    row.motion = { gait: 'down' }
    members = [memberOf(row, 'Ada <hero>', 1000)]
    view.paint(frame)
    equal(health()?.getAttribute('aria-valuenow'), '0')
    ok(text().includes('Fainted'))
    members = [memberOf(row, 'Ada <hero>', 20000)]
    view.paint(frame)
    equal(health(), null)
    ok(text().includes('Live stats unavailable'))
    ok(!text().includes(ITEMS.sword1.name))
    ok(text().includes('Equipment unavailable'))
  }))

test('friends are listed to invite, or the player is asked to allow them', () =>
  withDom(async (_, body) => {
    let invited: string[] = []
    let friends: Friends = { kind: 'ask', allow: 'https://yaks.test/allow' }
    let party = {
      canJoin: true,
      invites: [],
      members: [],
      group: '',
      get friends() {
        return friends
      },
      readFriends: () => Promise.resolve(),
      together: (person: string) => person == 'p2',
      inviteFriend: (person: string) =>
        Promise.resolve((invited.push(person), true)),
    } as unknown as ReturnType<typeof parties>
    let toasts: string[] = []
    let view = partybox(
      { body, open: true, show() {}, close() {}, toggle() {}, head() {} },
      party,
      (s) => toasts.push(s),
    )
    let frame = { body: { x: 0, z: 0 } } as Frame
    view.paint(frame)
    let allow = body.querySelector<HTMLAnchorElement>('a[href]')
    equal(allow?.getAttribute('href'), 'https://yaks.test/allow')
    friends = {
      kind: 'friends',
      friends: [
        { person: 'p1', name: 'Wren', avatar: '', presence: 'online' },
        { person: 'p2', name: 'Tam', avatar: '', presence: 'away' },
      ],
    }
    view.paint(frame)
    let text = () => body.textContent!
    ok(text().includes('Wren') && text().includes('In your party'))
    body.querySelector<HTMLElement>('[data-select="friend:p2"]')!.click()
    equal(body.querySelector('[data-act="invite-friend"]'), null)
    body.querySelector<HTMLElement>('[data-select="friend:p1"]')!.click()
    body.querySelector<HTMLElement>('[data-act="invite-friend"]')!.click()
    await until(() => toasts.length > 0)
    equal(invited, ['p1'])
    equal(toasts, ['Invited Wren to your party.'])
  }))

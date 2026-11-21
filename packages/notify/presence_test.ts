import { equal, test } from '@yaks/testing'
import {
  type Channel,
  glance,
  noted,
  presenceLine,
  reachBy,
  type Row,
  type State,
  tabsState,
} from './presence.ts'

let T = Date.parse('2026-11-20T12:00:00Z')
let MIN = 60_000
let say = (channel: Channel, state: State, place?: string) => ({
  person: 'jeff',
  channel,
  state,
  ...place ? { place } : {},
})
let row = (channel: Channel, state: State, ago = 0, place?: string) => ({
  entity: { eid: channel + (place ?? '') },
  presence: {
    ...say(channel, state, place),
    at: new Date(T - ago).toISOString(),
  },
} as Row)

test('a state is written when it changes, or again once a third of its fade has passed', () => {
  let here = row('operator', 'here', 0, 's')
  let wrote = (r: Row | undefined, s: State, ago = 0) =>
    !!noted(r, say('operator', s, 's'), T + ago)
  equal(wrote(undefined, 'here'), true)
  equal(wrote(here, 'here', 4 * MIN), false)
  equal(wrote(here, 'here', 6 * MIN), true)
  equal(wrote(here, 'background'), true)
  equal(wrote(here, 'away'), true)
  equal(wrote(undefined, 'away'), false)
  equal(wrote(row('operator', 'away', 0, 's'), 'away', 10 * MIN), false)
  // a page faded already needs no "away"
  equal(wrote(row('operator', 'here', 0, 's'), 'away', 20 * MIN), false)
})

test('tabs: one focused is here, any open is background, none is away', () => {
  let t = (visible: boolean, focused: boolean) => ({ visible, focused })
  equal(tabsState([t(false, false), t(true, true)]), 'here')
  equal(tabsState([t(true, false)]), 'background')
  equal(tabsState([]), 'away')
})

test('the line and the reach, from the rows still standing', () => {
  let cases: [Row[], string, string][] = [
    [
      [row('operator', 'here', 0, 'home'), row('discord', 'online')],
      'Jeff: here, this tab · Discord online',
      'tab',
    ],
    [
      [row('operator', 'background', 0, 'home')],
      'Jeff: this Operator open in a background tab',
      'notification',
    ],
    [
      [row('operator', 'here', 0, 'other')],
      'Jeff: on yaks.app, not on this Operator',
      'notification',
    ],
    [
      [row('apps', 'open'), row('discord', 'idle')],
      'Jeff: on yaks.app, not on this Operator · Discord idle',
      'notification',
    ],
    [
      [row('operator', 'here', 20 * MIN, 'home'), row('discord', 'online')],
      'Jeff: not on yaks.app · Discord online',
      'discord',
    ],
    [
      [row('text', 'used', 2 * 60 * MIN), row('email', 'used', 30 * 60 * MIN)],
      'Jeff: not on yaks.app · texted 2h ago',
      'usual',
    ],
  ]
  for (let [rows, line, reach] of cases) {
    let g = glance(rows, { place: 'home', now: T })
    equal([presenceLine('Jeff', g), reachBy(g)], [line, reach])
  }
})

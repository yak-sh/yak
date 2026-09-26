// The limits on what a villager hands over, through the rules that hold them
// (stock.ts): whatever a hero talked a villager into writing, a deal counts
// only as far as the villager's stock, the land and the worth of what it asks
// allow, and every page that reads the same rows reaches the same answer.
import { assertEquals } from '@std/assert'
import { GIVERS } from './quests.ts'
import { type Deal, GAP, type Hand, LAST, ledger } from './stock.ts'

let wren = GIVERS.find((g) => g.id == 'wren')!
let MIN = 60_000

// Ada made the hero `hero`, Bob made `rook`.
let owner = (hero: string) => ({ hero: 'ada', rook: 'bob' })[hero] ?? null

// A deal Wren makes at `at` minutes: what she gives, for what, written by
// whom, with which hero.
let deal = (
  at: number,
  give: string,
  take = '',
  by = 'ada',
  player = 'hero',
) => ({
  eid: `${at}/${give}/${take}/${by}`,
  player,
  give,
  take,
  by,
  at: at * MIN,
})

let hand = (d: Deal, at: number, by = 'ada'): Hand => ({
  eid: `hand/${d.eid}/${by}`,
  deal: d.eid,
  player: d.player,
  by,
  at: at * MIN,
})

// What Wren's rows come to at `now` minutes: each deal's state, and how many
// of each of `kinds` she holds.
let book = (deals: Deal[], hands: Hand[] = [], now = 10, kinds = ['coin']) => {
  let b = ledger(wren, deals, hands, owner, now * MIN)
  return {
    states: deals.map((d) => b.states.get(d.eid)),
    holds: kinds.map((k) => b.holds.get(k) ?? 0),
  }
}

Deno.test('a gift beyond what the villager holds gives nothing', () => {
  assertEquals(book([deal(0, '1000 coin')]), {
    states: ['void'],
    holds: [20],
  })
  assertEquals(book([deal(0, '20 coin')]), { states: ['open'], holds: [0] })
})

Deno.test('what a villager holds is finite, and comes back slowly', () => {
  let gifts = [deal(0, '15 coin'), deal(1, '15 coin', '', 'bob', 'rook')]
  let hands = [hand(gifts[0], 1)]
  assertEquals(book(gifts, hands, 1), { states: ['done', 'void'], holds: [5] })
  // A coin every three minutes, up to the twenty she keeps.
  assertEquals(book(gifts, hands, 31).holds, [15])
  assertEquals(book(gifts, hands, 600).holds, [20])
})

Deno.test("a gift is small, and never one of the villager's own things", () => {
  let asks = [deal(0, '1 staff2'), deal(1, '2 tonic, 20 coin', '', 'bob')]
  assertEquals(book(asks).states, ['void', 'void'])
  assertEquals(book([deal(0, '1 tonic, 2 coin')]).states, ['open'])
})

Deno.test('a person gets one gift from a villager in a while', () => {
  let asks = [
    deal(0, '1 coin'),
    deal(10, '1 coin'),
    deal(11, '1 coin', '', 'bob', 'rook'),
    deal(GAP / MIN, '1 coin'),
  ]
  assertEquals(book(asks, [], 60).states, ['open', 'void', 'open', 'open'])
})

Deno.test('a hand-in counts once, from the person who made the hero', () => {
  let gift = deal(0, '5 coin')
  let states = (hands: Hand[]) => book([gift], hands, 5).states
  assertEquals(states([hand(gift, 1, 'bob')]), ['open'])
  assertEquals(states([hand(gift, 1), hand(gift, 2)]), ['done'])
})

Deno.test('what a deal set aside is free again if it is never handed in', () => {
  // Wren's staff, for the Thornback and a sword to replace it.
  let staff = deal(0, '1 staff2', '1 thornback, 1 sword2')
  let holds = (now: number, hands: Hand[] = []) =>
    book([staff], hands, now, ['staff2', 'sword2']).holds
  assertEquals(holds(1), [0, 0])
  assertEquals(holds(LAST / MIN + 1), [1, 0])
  assertEquals(holds(LAST / MIN + 1, [hand(staff, 5)]), [0, 1])
})

Deno.test('every page reaches the same answer from the same rows', () => {
  let deals = [
    deal(0, '15 coin'),
    deal(0, '15 coin', '', 'bob', 'rook'),
    deal(3, '1 tonic', '', 'cat', 'rook'),
    deal(3, '1 tonic', '', 'dan', 'rook'),
  ]
  let hands = [hand(deals[0], 1), hand(deals[1], 1, 'bob')]
  let a = book(deals, hands, 10, ['coin', 'tonic'])
  let b = book(deals.toReversed(), hands.toReversed(), 10, ['coin', 'tonic'])
  assertEquals(b.holds, a.holds)
  assertEquals(
    book(deals.toReversed(), hands, 10).states.toReversed(),
    a.states,
  )
})

// The limits on what a villager hands over, through the rules that hold them
// (stock.ts): whatever a hero talked a villager into writing, a deal counts
// only as far as the villager's stock, the land and the worth of what it asks
// allow, a job on the board goes to one hero, and every page that reads the
// same rows reaches the same answer.
import { assertEquals } from '@std/assert'
import { GIVERS } from './quests.ts'
import {
  BOARD,
  type Deal,
  GAP,
  goods,
  LAST,
  ledger,
  OFFER,
  pay,
  POSTED,
  RARE,
  type Reply,
} from './stock.ts'

let MIN = 60_000

// A land's people, each by the row their deals name.
let land = (level: string) =>
  new Map(GIVERS.filter((g) => g.level == level).map((g) => [g.id, g]))

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
  villager: 'wren',
  player,
  give,
  take,
  by,
  via: 'wren',
  at: at * MIN,
})

// A job a villager pins on the board at `at` minutes, for any hero.
let job = (at: number, give: string, take: string, villager = 'wren') => ({
  ...deal(at, give, take, 'ada', ''),
  eid: `job/${villager}/${at}`,
  villager,
  via: villager,
})

// A hero's reply to a deal at `at` minutes: handed in, or agreed to; by the
// hero it names, or for a job, the hero `by` made.
let reply = (
  d: Deal,
  at: number,
  by = 'ada',
  did: Reply['did'] = 'handed',
): Reply => ({
  eid: `${did}/${d.eid}/${by}`,
  deal: d.eid,
  player: d.player || ({ ada: 'hero', bob: 'rook' })[by] || '',
  did,
  by,
  at: at * MIN,
})
let hand = (d: Deal, at: number, by = 'ada') => reply(d, at, by)
let agree = (d: Deal, at: number, by = 'ada') => reply(d, at, by, 'agreed')

// What Wren's rows come to at `now` minutes: each deal's state, and how many
// of each of `kinds` she holds.
let book = (deals: Deal[], hands: Reply[] = [], now = 10, kinds = ['coin']) => {
  let b = ledger(land('mossvale'), deals, hands, owner, now * MIN).get('wren')!
  return {
    states: deals.map((d) => b.states.get(d.eid)),
    holds: kinds.map((k) => b.holds.get(k) ?? 0),
  }
}

Deno.test("only the villager's own turn makes a deal", () => {
  // A row a page wrote itself, naming the villager, came through no turn of
  // theirs.
  let forged = { ...deal(0, '5 coin'), via: '' }
  assertEquals(book([forged, deal(1, '5 coin', '', 'bob', 'rook')]), {
    states: ['void', 'open'],
    holds: [15],
  })
})

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
  let counted = book(asks, [], 60).states.map((s) => s != 'void')
  assertEquals(counted, [true, false, true, true])
})

Deno.test('a hand-in counts once, from the person who made the hero', () => {
  let gift = deal(0, '5 coin')
  let states = (hands: Reply[]) => book([gift], hands, 5).states
  assertEquals(states([hand(gift, 1, 'bob')]), ['open'])
  assertEquals(states([hand(gift, 1), hand(gift, 2)]), ['done'])
})

Deno.test('what a deal set aside is free again if it is never handed in', () => {
  // Wren's staff, for the Thornback and a sword to replace it.
  let staff = deal(0, '1 staff2', '1 thornback, 1 sword2')
  let holds = (now: number, hands: Reply[] = []) =>
    book([staff], hands, now, ['staff2', 'sword2']).holds
  assertEquals(holds(1), [0, 0])
  // An offer nobody agreed to lapses soon; one agreed to stands a day.
  assertEquals(holds(OFFER / MIN + 1), [1, 0])
  assertEquals(holds(OFFER / MIN + 1, [agree(staff, 5)]), [0, 0])
  assertEquals(holds(LAST / MIN + 6, [agree(staff, 5)]), [1, 0])
  assertEquals(holds(LAST / MIN, [agree(staff, 5), hand(staff, 60)]), [0, 1])
  // Only the person who made the hero agrees for them.
  assertEquals(holds(OFFER / MIN + 1, [agree(staff, 5, 'bob')]), [1, 0])
})

Deno.test('a trade moves only things both sides hold', () => {
  let trade = deal(0, '1 tonic', '6 tusk')
  let kinds = ['tonic', 'tusk']
  assertEquals(book([trade], [], 1, kinds).holds, [1, 4])
  // Handed in, the tonic is the hero's and the tusks are Wren's.
  assertEquals(book([trade], [hand(trade, 1)], 1, kinds).holds, [1, 10])
  // She never promises what she does not hold.
  assertEquals(book([deal(0, '3 tonic', '9 tusk')]).states, ['void'])
  // And a hero pays only from their bag.
  let bag = [{ eid: 't1', kind: 'tusk', n: 1 }]
  assertEquals(pay(bag, goods('3 tusk')!), null)
  assertEquals(pay(bag, goods('1 tusk, 1 thornback')!), {
    spend: ['t1'],
    back: [],
  })
})

Deno.test('a deal asks only for what the land has', () => {
  let asks = [
    deal(0, '5 coin', '1 frostwolf'),
    deal(1, '5 coin', '1 pearl', 'bob', 'rook'),
    deal(2, '5 coin', '2 boar', 'cat', 'cat'),
    deal(3, '5 coin', '1 tusk', 'dan', 'dan'),
  ]
  assertEquals(book(asks).states, ['void', 'void', 'open', 'open'])
})

Deno.test('a deal gives about what its ask is worth, and precious things only for much', () => {
  let asks = [
    // The staff for the Thornback alone is too much; with a stone to boot,
    // it is fair.
    deal(0, '1 staff2', '1 thornback'),
    deal(1, '1 staff2', '1 thornback, 1 toadstone', 'bob', 'rook'),
    // Never for nothing: a plain rack sword is worth nothing.
    deal(2, '1 ring1', '1 sword1', 'cat', 'cat'),
  ]
  assertEquals(book(asks).states, ['void', 'open', 'void'])
})

Deno.test('a newer offer takes the place of one the hero has not agreed to', () => {
  let first = deal(0, '1 tonic', '6 tusk')
  let second = deal(1, '1 tonic', '5 tusk')
  let tonics = (replies: Reply[]) =>
    book([first, second], replies, 2, ['tonic'])
  assertEquals(tonics([]), { states: ['gone', 'open'], holds: [1] })
  assertEquals(tonics([agree(first, 0.5)]), {
    states: ['taken', 'open'],
    holds: [0],
  })
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

Deno.test('a job on the board goes to the first hero to take it', () => {
  let j = job(0, '5 coin', '2 boar')
  let states = (replies: Reply[]) => book([j], replies).states
  let rook = agree(j, 1, 'bob')
  // Taken by Rook, it is gone for the hero after, and Rook's to hand in.
  assertEquals(states([rook, agree(j, 2)]), ['taken'])
  assertEquals(states([rook, hand(j, 3)]), ['taken'])
  assertEquals(states([rook, hand(j, 3, 'bob')]), ['done'])
})

Deno.test('a job holds to what the villager holds, the land has, and its worth', () => {
  let one = (give: string, take: string) => book([job(0, give, take)]).states
  assertEquals(
    [
      one('1000 coin', '2 boar'),
      one('5 coin', '1 frostwolf'),
      one('1 staff2', '1 slime'),
      one('5 coin', ''),
    ].flat(),
    ['void', 'void', 'void', 'void'],
  )
  assertEquals(one('1 staff2', '1 thornback, 1 toadstone'), ['open'])
})

Deno.test('a villager posts now and then, and a board holds a few jobs', () => {
  let first = job(0, '1 coin', '1 slime')
  let again = (at: number, replies: Reply[] = []) =>
    book([first, job(at, '1 coin', '1 slime')], replies, at + 1).states[1]
  let done = [agree(first, 1), hand(first, 2)]
  // One of theirs on the board at a time, and a while between them.
  assertEquals(again(RARE / MIN), 'void')
  assertEquals(again(30, done), 'void')
  assertEquals(again(RARE / MIN, done), 'open')
  // Every one of Birchmere's people posts one: the board takes the first
  // few, and has room again once a hero takes one of them.
  let mere = land('birchmere')
  let jobs = [...mere.keys()].map((v, i) => job(i, '1 coin', '1 adder', v))
  let at = (replies: Reply[]) => ledger(mere, jobs, replies, owner, 20 * MIN)
  let books = at([])
  assertEquals(
    jobs.map((j) => books.get(j.villager)!.states.get(j.eid)),
    jobs.map((_, i) => i < BOARD ? 'open' : 'void'),
  )
  let last = jobs.at(-1)!.villager
  assertEquals(books.get(last)!.room, false)
  assertEquals(at([agree(jobs[0], 15, 'bob')]).get(last)!.room, true)
})

Deno.test('a job nobody takes comes down, and what it set aside is free again', () => {
  let j = job(0, '1 tonic', '6 tusk')
  let tonics = (now: number) => book([j], [], now, ['tonic']).holds
  assertEquals(tonics(60), [1])
  assertEquals(tonics(POSTED / MIN + 1), [2])
})

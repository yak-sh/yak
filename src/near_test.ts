// The near match: what a failed handle lookup may name. Scoring only —
// the check that a suggestion RESOLVES belongs to the door that offers it
// (client.ts nearby), and client_test drives that half.
import { assertEquals } from '@std/assert'
import { nearest, offer } from './near.ts'

let P = (id: string, alias: string, title: string) => ({ id, alias, title })
let fleet = [
  P('P-19', 'home', 'Task Graph'),
  P('P-20', 'holdco', 'holdco'),
  P('P-22', 'crayonbloom', 'crayonbloom'),
  P('P-26', 'harness', 'harness'),
  P('P-30', 'bindery', 'bindery'),
]

Deno.test('nearest: a title word answers the alias nobody could guess', () => {
  // the reported shape: `tasks` IS the venture, `home` is its handle
  assertEquals(nearest('tasks', fleet)?.id, 'P-19')
  assertEquals(nearest('task graph', fleet)?.id, 'P-19')
  // a typo in the alias itself
  assertEquals(nearest('holdc', fleet)?.id, 'P-20')
  assertEquals(nearest('harnes', fleet)?.id, 'P-26')
  // a prefix of a long alias
  assertEquals(nearest('crayon', fleet)?.id, 'P-22')
})

Deno.test('nearest: nothing close is nothing offered', () => {
  assertEquals(nearest('flux', fleet), undefined)
  assertEquals(nearest('', fleet), undefined)
  assertEquals(nearest('tasks', []), undefined)
  // one letter is not evidence of anything
  assertEquals(nearest('h', fleet), undefined)
  // a stub inside a long title is coincidence, not a match: `jef` sits in
  // every task titled after jeff@yak.sh, and named one of them
  assertEquals(
    nearest('jef', [{
      id: 'T-47',
      alias: 'email-channel-to-owner',
      title: 'Two-way email between holdco and the owner (jeff@yak.sh)',
    }]),
    undefined,
  )
  assertEquals(nearest('jef', [{ id: 'U-3709', alias: 'jeff' }])?.id, 'U-3709')
})

Deno.test('nearest: duplicate names are told apart by the handle', () => {
  // Ids alone do not disambiguate — both boards are titled `holdco`, so
  // the winner is whichever the caller's word matches, and offer() prints
  // the alias that tells them apart.
  let boards = [
    { id: 'B-21', alias: 'holdco-board', title: 'holdco' },
    { id: 'B-27', alias: 'harness-board', title: 'harness (dead)' },
  ]
  assertEquals(nearest('holdco', boards)?.id, 'B-21')
  assertEquals(nearest('harness', boards)?.id, 'B-27')
  assertEquals(
    offer(nearest('holdco', boards)!),
    "'holdco-board' (B-21, holdco)",
  )
})

Deno.test('offer: the handle leads, because it is what they got wrong', () => {
  assertEquals(
    offer(P('P-19', 'home', 'Task Graph')),
    "'home' (P-19, Task Graph)",
  )
  assertEquals(offer({ id: 'P-19', title: 'Task Graph' }), 'P-19 (Task Graph)')
  assertEquals(offer({ id: 'P-19', alias: 'home' }), "'home' (P-19)")
  assertEquals(offer({ id: 'P-19' }), 'P-19')
})

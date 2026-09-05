// The scoring on its own: what counts as the same name, and what is a stranger.

import { assert, assertEquals } from '@std/assert'
import { CLOSE, closeness, nearest, score } from './match.ts'

Deno.test('the same name scores 1, however it is written', () => {
  assertEquals(score('Ursula Le Guin', 'ursula le guin'), 1)
  assertEquals(score('le-guin', 'Le Guin'), 1)
  assertEquals(score('', 'Le Guin'), 0)
})

Deno.test('a prefix outranks a word merely spelled inside', () => {
  assert(score('earth', 'Earthsea') > score('sea', 'Earthsea'))
  // a two-letter word inside a name is coincidence, not a reach
  assert(score('le', 'Le Guin') < CLOSE)
})

Deno.test('a name answers to its first word too, at a discount', () => {
  assert(closeness('ursula', 'Ursula Le Guin') > 0.6)
  assert(closeness('ursula', 'Ursula Le Guin') < 1)
})

Deno.test('nearest takes the closest above the floor, or nothing', () => {
  let of = [{ n: 'Earthsea' }, { n: 'Ursula Le Guin' }, { n: undefined }]
  let name = (x: { n?: string }) => x.n
  assertEquals(nearest('earthsea', of, name), of[0])
  assertEquals(nearest('le guin', of, name), of[1])
  assertEquals(nearest('dickens', of, name), undefined)
  // the floor is the caller's: 1 accepts only the name as stored
  assertEquals(nearest('earthse', of, name), of[0])
  assertEquals(nearest('earthse', of, name, 1), undefined)
})

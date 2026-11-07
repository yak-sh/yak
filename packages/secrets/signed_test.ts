// A signed value opens for its own label under its own secret, and nothing else.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { claimed, opened, signed } from './signed.ts'

let value = { person: 'p', exp: 1 }

let ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

// Every token one character away: at each position, the character with each
// of its low two bits flipped, the bits a mac's last character pads with.
let edits = (token: string) =>
  [...token].flatMap((c, i) =>
    [1, 2, 3].map((bit) =>
      token.slice(0, i) +
      (ALPHABET[ALPHABET.indexOf(c) ^ bit] ?? 'A') +
      token.slice(i + 1)
    )
  )

test('a token opens for its label and secret alone', async () => {
  let token = await signed('a', value, 's')
  assertEquals(await opened('a', token, 's'), value)
  assertEquals(await opened('b', token, 's'), null)
  assertEquals(await opened('a', token, 't'), null)
  assertEquals(await opened('a', token.slice(0, -2) + 'AA', 's'), null)
  assertEquals(await opened('a', 'no dot', 's'), null)
})

test('a token with any one character changed, padded or spaced, opens nothing', async () => {
  let token = await signed('a', value, 's')
  for (let round of ['fresh', 'after an open']) {
    for (let t of [...edits(token), `${token}=`, `${token} `]) {
      assertEquals(await opened('a', t, 's'), null, `${round}: ${t}`)
    }
    assertEquals(await opened('a', token, 's'), value)
  }
})

test('signing is deterministic, so a repeat is the same token', async () => {
  assertEquals(await signed('a', value, 's'), await signed('a', value, 's'))
})

test('claimed reads the body without the secret', async () => {
  assertEquals(claimed(await signed('a', value, 's')), value)
  assertEquals(claimed('junk'), null)
})

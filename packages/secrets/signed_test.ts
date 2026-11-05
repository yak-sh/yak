// A signed value opens for its own label under its own secret, and nothing else.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { claimed, opened, signed } from './signed.ts'

let value = { person: 'p', exp: 1 }

test('a token opens for its label and secret alone', async () => {
  let token = await signed('a', value, 's')
  assertEquals(await opened('a', token, 's'), value)
  assertEquals(await opened('b', token, 's'), null)
  assertEquals(await opened('a', token, 't'), null)
  assertEquals(await opened('a', token.slice(0, -2) + 'AA', 's'), null)
  assertEquals(await opened('a', 'no dot', 's'), null)
})

test('signing is deterministic, so a repeat is the same token', async () => {
  assertEquals(await signed('a', value, 's'), await signed('a', value, 's'))
})

test('claimed reads the body without the secret', async () => {
  assertEquals(claimed(await signed('a', value, 's')), value)
  assertEquals(claimed('junk'), null)
})

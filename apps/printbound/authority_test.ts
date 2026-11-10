import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { who as printbound } from './store.ts'
import { who as crayonbloom } from '../crayonbloom/db.ts'

test('prior browsers are accepted only with a verified person and UUID values', () => {
  let via = crypto.randomUUID(), person = crypto.randomUUID()
  for (let who of [printbound, crayonbloom]) {
    let headers = { 'x-yak-via': via, 'x-yak-browsers': via + ',invalid' }
    assertEquals(
      who(new Request('https://app.invalid/', { headers })).browsers,
      undefined,
    )
    assertEquals(
      who(
        new Request('https://app.invalid/', {
          headers: { ...headers, 'x-yak-person': person },
        }),
      ).browsers,
      [via],
    )
  }
})

import { assertEquals } from '@std/assert'
import { lookup, place, when } from './app.ts'

let at = (pathname: string, search = '', hash = '') =>
  place({ pathname, search, hash })

Deno.test('an address names home, a search, or an id', () => {
  assertEquals(at('/'), { home: '' })
  assertEquals(at('/', '?q=web%20door'), { home: 'web door' })
  assertEquals(at('/T-9'), { id: 'T-9' })
  assertEquals(at('/T', '', '#8d83e663ef'), { id: 'T#8d83e663ef' })
  assertEquals(at('/T-9', '', '#c2'), { id: 'T-9' })
})

Deno.test('an id is looked up by its number, its handle, or its eid', () => {
  assertEquals(lookup('T-9'), '.num=9&*')
  assertEquals(lookup('t-9'), '.num=9&*')
  assertEquals(lookup('T#8d83e663ef'), '.eid~=8d83e663-ef&*')
  assertEquals(
    lookup('8D83E663-EFBC-4E3B-BF51-78C04F4AC040'),
    '.eid=8d83e663-efbc-4e3b-bf51-78c04f4ac040&*',
  )
  assertEquals(lookup('web door'), undefined)
})

Deno.test('a moment reads as how long ago within the week, a date after', () => {
  let now = Date.parse('2026-09-23T12:00:00Z')
  assertEquals(when('2026-09-23T11:30:00Z', now), '30 minutes ago')
  assertEquals(when('2026-09-21T12:00:00Z', now), '2 days ago')
  assertEquals(when('2026-08-01T12:00:00Z', now).includes('2026'), true)
  assertEquals(when('not a time', now), 'not a time')
})

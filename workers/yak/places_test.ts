// place_find: a place looked up once through Nominatim and kept in the
// directory, so asking again never reaches the geocoder (places.ts).
import { assertStringIncludes } from '@std/assert'
import { equal, test } from '@yaks/testing'
import { connector, kernel, seed } from './probe.ts'

test('a place is looked up once and its answer kept for everyone', async () => {
  let k = await kernel()
  let person = await seed(k, [{ slug: 'places-fixture', apps: [] }])
  let agent = connector(k, person.cookie)
  let asked: string[] = []
  let was = globalThis.fetch
  globalThis.fetch = (input, init) => {
    let url = input instanceof Request ? input.url : String(input)
    if (!url.startsWith('https://nominatim.openstreetmap.org/')) {
      return was(input, init)
    }
    asked.push(url)
    return Promise.resolve(Response.json([{
      lat: '1.3089',
      lon: '32.4637',
      display_name: 'Nakasongola, Central Region, Uganda',
    }]))
  }
  try {
    let find = () =>
      agent.tool('place_find', {
        space: 'places-fixture',
        query: 'Nakasongola,  Uganda',
      })
    let first = await find()
    assertStringIncludes(first, '<Place at={[32.4637, 1.3089]} />')
    assertStringIncludes(first, 'OpenStreetMap')
    equal(await find(), first)
    equal(asked.length, 1)
  } finally {
    globalThis.fetch = was
  }
})

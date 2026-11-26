import { assertEquals, assertRejects } from '@std/assert'
import { AGENT, type Geocode, lookup, type Lookups } from './lookup.ts'
import { GEOCODERS } from './providers.ts'

let nominatim = GEOCODERS.nominatim

// A host whose geocoder answers `answers` in turn, on a clock that only
// moves when it sleeps.
let host = (answers: unknown[], status = 200) => {
  let kept = new Map<string, Geocode>()
  let asked: Request[] = [], slept: number[] = []
  let t = 1_000_000
  let h: Lookups = {
    read: (p, q) => Promise.resolve(kept.get(`${p} ${q}`) ?? null),
    keep: (a) => Promise.resolve(void kept.set(`${a.provider} ${a.query}`, a)),
    fetch: (req) => {
      asked.push(req)
      return Promise.resolve(Response.json(answers.shift(), { status }))
    },
    now: () => t,
    sleep: (ms) => Promise.resolve(void (slept.push(ms), t += ms)),
  }
  return { h, kept, asked, slept }
}

let MASOOLI = [{ lat: '0.4300', lon: '32.5825', display_name: 'Masooli' }]

Deno.test('a lookup asks once and keeps the answer', async () => {
  let { h, asked, kept } = host([MASOOLI])
  let first = await lookup(nominatim, ' Masooli,  Uganda', h)
  assertEquals([first.lat, first.lng, first.address], [
    0.43,
    32.5825,
    'Masooli',
  ])
  assertEquals(first.query, 'masooli, uganda')
  assertEquals(asked[0].headers.get('user-agent'), AGENT)
  let again = await lookup(nominatim, 'masooli, uganda', h)
  assertEquals(again, first)
  assertEquals(asked.length, 1)
  assertEquals(kept.size, 1)
})

Deno.test('nothing found is kept too', async () => {
  let { h, asked } = host([[]])
  let none = await lookup(nominatim, 'nowhere at all', h)
  assertEquals([none.lat, none.address], [undefined, undefined])
  await lookup(nominatim, 'nowhere at all', h)
  assertEquals(asked.length, 1)
})

Deno.test('calls are paced by the geocoder interval', async () => {
  let { h, slept } = host([MASOOLI, MASOOLI])
  await lookup(nominatim, 'paced one', h)
  await lookup(nominatim, 'paced two', h)
  assertEquals(slept.at(-1), nominatim.interval)
})

Deno.test('a refusal is thrown and nothing kept', async () => {
  let { h, kept } = host([{ error: 'busy' }], 429)
  await assertRejects(() => lookup(nominatim, 'refused place', h), Error, '429')
  assertEquals(kept.size, 0)
})

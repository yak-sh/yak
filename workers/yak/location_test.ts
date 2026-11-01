import { equal, test } from '@yaks/testing'
import { located, LOCATION, locationOf, regionOf } from './location.ts'

test('geography selects a supported nearby region', () => {
  for (
    let [continent, longitude, country, expected] of [
      ['EU', '2', 'FR', 'weur'],
      ['EU', '37', 'RU', 'eeur'],
      ['NA', '-122', 'US', 'wnam'],
      ['NA', '-74', 'US', 'enam'],
      ['AS', '139', 'JP', 'apac'],
      ['AS', '54', 'AE', 'me'],
      ['AF', '18', 'ZA', 'afr'],
      ['OC', '151', 'AU', 'oc'],
      ['SA', '-46', 'BR', 'sam'],
      ['AN', '0', 'AQ', undefined],
    ]
  ) equal(regionOf({ continent, longitude, country }), expected)
  equal(regionOf(), undefined)
})

test('the front replaces forged hints and retains a streamed write', async () => {
  let req = Object.assign(
    new Request('https://yaks.app/mcp', {
      method: 'POST',
      body: new Blob(['make an app']).stream(),
      headers: { [LOCATION]: 'wnam', authorization: 'Bearer session' },
    }),
    { cf: { continent: 'EU' } },
  )
  let out = located(req)
  equal(locationOf(out), 'weur')
  equal(out.method, 'POST')
  equal(out.headers.get('authorization'), 'Bearer session')
  equal(await out.text(), 'make an app')
  equal(
    locationOf(new Request(req.url, { headers: { [LOCATION]: 'invalid' } })),
    undefined,
  )
})

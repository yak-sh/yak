// The public client asks a read once however many callers want it at the
// same moment, and each caller still holds its own answer.
import { assertEquals, assertNotStrictEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { test } from '@yaks/testing'
import { store } from './public/client.js'

let base = 'https://reads-client.test/house/api/'
let asked = (answer: (path: string) => unknown) => {
  let paths: string[] = []
  let fetching = stub(globalThis, 'fetch', (url) => {
    let path = String(url).slice(base.length)
    paths.push(path)
    return Promise.resolve(Response.json(answer(path)))
  })
  return { paths, [Symbol.dispose]: () => fetching.restore() }
}

test('reads asked together are one request, each caller its own rows', async () => {
  using wire = asked((path) =>
    path == 'me' ? { person: 'jo' } : [{ entity: { eid: path } }]
  )
  let client = store(base)
  let [one, two] = await Promise.all([client.me(), client.me()])
  let [rows, same, other] = await Promise.all([
    client.query('.house_item'),
    client.query('.house_item'),
    client.query('.house_file'),
  ])
  assertEquals(wire.paths, ['me', 'query?.house_item', 'query?.house_file'])
  assertEquals([one, two], [{ person: 'jo' }, { person: 'jo' }])
  assertNotStrictEquals(one, two)
  assertEquals(rows, same)
  assertNotStrictEquals(rows, same)
  assertEquals(other, [{ entity: { eid: 'query?.house_file' } }])
})

test('a read asked again after its answer is asked again', async () => {
  using wire = asked(() => ({ person: 'jo' }))
  let client = store(base)
  await client.me()
  await client.me()
  assertEquals(wire.paths, ['me', 'me'])
})

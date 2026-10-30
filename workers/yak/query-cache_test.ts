import { equal, test } from '@yaks/testing'
import { queryCache } from './query-cache.ts'

test('a query reuses bytes until the data changes, preserving its headers', async () => {
  let version = 0, reads = 0
  let query = queryCache(() => version, () => {
    reads++
    return Promise.resolve(Response.json({ version }, {
      headers: { 'x-result': 'kept' },
    }))
  })
  let first = await query(new Request('http://directory/query?q=.doc'))
  equal(await first.json(), { version: 0 })
  let second = await query(new Request('http://directory/query?q=.doc'))
  equal(await second.json(), { version: 0 })
  equal(second.headers.get('x-result'), 'kept')
  equal(reads, 1)
  version++
  equal(
    await (await query(new Request('http://directory/query?q=.doc'))).json(),
    {
      version: 1,
    },
  )
  equal(reads, 2)
})

test('callers and query parameters have independent answers', async () => {
  let reads = 0
  let query = queryCache(() => 0, (request) => {
    reads++
    return Promise.resolve(Response.json({
      person: request.headers.get('x-yak-person'),
      query: new URL(request.url).searchParams.get('q'),
    }))
  })
  let read = (person: string, q = '.doc') =>
    query(
      new Request(`http://directory/query?q=${q}`, {
        headers: {
          'x-yak-person': person,
          'idempotency-key': crypto.randomUUID(),
        },
      }),
    ).then((r) => r.json())
  equal(await read('ada'), { person: 'ada', query: '.doc' })
  equal(await read('bob'), { person: 'bob', query: '.doc' })
  equal(await read('ada'), { person: 'ada', query: '.doc' })
  equal(await read('ada', '.person'), { person: 'ada', query: '.person' })
  equal(reads, 3)
})

test('a read overtaken by a mutation cannot fill the next revision', async () => {
  let version = 0, reads = 0
  let release!: (answer: Response) => void
  let query = queryCache(() => version, () => {
    reads++
    return new Promise<Response>((resolve) => release = resolve)
  })
  let request = () => new Request('http://directory/query?q=.doc')
  let old = query(request())
  version++
  release(Response.json('old'))
  equal(await (await old).json(), 'old')
  let fresh = query(request())
  release(Response.json('fresh'))
  equal(await (await fresh).json(), 'fresh')
  equal(await (await query(request())).json(), 'fresh')
  equal(reads, 2)
})

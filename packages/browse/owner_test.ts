import { equal, ok, test } from '@yaks/testing'
import { ownerReads } from './owner.ts'

let response = (owner: unknown, status = 200) =>
  new Response(JSON.stringify({ owner }), { status })
let url = 'https://graph.test/web/owner'

test('boot can await an owner read already in flight without identifying twice', async () => {
  let answer = Promise.withResolvers<Response>(), calls = 0
  let reads = ownerReads(() => {
    calls++
    return answer.promise
  })
  reads.begin(url)
  equal(calls, 1)
  let boot = reads.initial(url), complete = false
  void boot.then(() => complete = true)
  await Promise.resolve()
  equal(complete, false)
  answer.resolve(response('alice'))
  equal(await boot, 'alice')
  equal(calls, 1)
})

test('outbox owner checks remain fresh after boot and account changes', async () => {
  let calls = 0
  let reads = ownerReads(() =>
    Promise.resolve(response(++calls == 1 ? 'alice' : 'bob'))
  )
  reads.begin(url)
  equal(await reads.initial(url), 'alice')
  equal(await reads.fresh(url), 'bob')
  equal(await reads.initial(url), 'bob')
  equal(calls, 3)
})

test('a different mount cannot consume the prefetched owner of another door', async () => {
  let urls: string[] = []
  let reads = ownerReads((at) => {
    urls.push(at)
    return Promise.resolve(response(at))
  })
  reads.begin(url)
  let other = 'https://graph.test/another/owner'
  equal(await reads.initial(other), other)
  equal(urls, [url, other])
})

test('startup rejects refused and malformed identities before boot proceeds', async () => {
  for (let res of [response('alice', 403), response(null), response('')]) {
    let reads = ownerReads(() => Promise.resolve(res))
    reads.begin(url)
    let error: unknown
    try {
      await reads.initial(url)
    } catch (e) {
      error = e
    }
    ok(error instanceof Error)
    equal((error as Error).message, 'Could not identify the write owner')
  }
})

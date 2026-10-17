import { assert, assertEquals } from '@std/assert'
import { clock, test } from '@yaks/testing'
import { changes } from './wait.ts'

let flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

test('unchanged revisions skip expensive reads until the timeout final read', async () => {
  let time = clock(), checks = 0, reads = 0
  let g = { storage: { revision: () => (checks++, 1) } }
  let wait = (async () => {
    for await (let done of changes(g, { every: 5, timeout: 45, clock: time })) {
      reads++
      assertEquals(done, reads != 1)
    }
  })()
  await flush()
  for (let i = 0; i < 9; i++) {
    await time.advance(5)
    await flush()
  }
  await wait
  assertEquals(reads, 2)
  assert(checks > 2)
})

test('a commit during the caller read is not missed', async () => {
  let time = clock(), revision = 1
  let it = changes({ storage: { revision: () => revision } }, { clock: time })
  assertEquals((await it.next()).value, false)
  revision++
  let next = it.next()
  await time.advance(1000)
  assertEquals((await next).value, false)
  await it.return(undefined)
})

test('stores without revision support are checked every beat', async () => {
  let time = clock()
  let it = changes({ storage: {} }, { clock: time })
  assertEquals((await it.next()).value, false)
  let next = it.next()
  await time.advance(1000)
  assertEquals((await next).value, false)
  await it.return(undefined)
})

test('abort wakes a sleeping wait without waiting for the beat', async () => {
  let stop = new AbortController(), time = clock()
  let it = changes({ storage: { revision: () => 1 } }, {
    every: 60_000,
    signal: stop.signal,
    clock: time,
  })
  assertEquals((await it.next()).value, false)
  let next = it.next()
  stop.abort()
  assertEquals((await next).value, true)
  assertEquals((await it.next()).done, true)
})

test('an already-aborted wait still makes its final read', async () => {
  let stop = new AbortController()
  stop.abort()
  let seen = []
  for await (let done of changes({ storage: {} }, { signal: stop.signal })) {
    seen.push(done)
  }
  assertEquals(seen, [true])
})

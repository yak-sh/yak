import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { within } from '../defects.ts'
import { inFlight, sharing } from './shared.ts'

let asking = <T>(run: () => T) => {
  let held: Promise<void>[] = []
  let result = within({}, {}, run, undefined, { retain: (w) => held.push(w) })
  return { result, held }
}

test('a request shares its unfinished read, and later requests share only its value', async () => {
  let kept = new Map<string, string>()
  let earlier = Promise.withResolvers<string>()
  let reads = 0
  let read = () => ++reads == 1 ? earlier.promise : Promise.resolve('newer')
  let first = asking(() =>
    Promise.all([sharing(kept, 'k', read), sharing(kept, 'k', read)])
  )
  let second = asking(() => sharing(kept, 'k', read))
  assertEquals([reads, first.held.length, second.held.length], [2, 1, 1])
  assertEquals(await second.result, 'newer')
  earlier.resolve('earlier')
  assertEquals(await first.result, ['earlier', 'earlier'])
  assertEquals(await asking(() => sharing(kept, 'k', read)).result, 'newer')
  assertEquals(reads, 2)
})

test('a failed read is retried within the same request', async () => {
  let kept = new Map<string, string>()
  let { result } = asking(async () => {
    let failed = sharing(kept, 'k', () => Promise.reject(new Error('bucket')))
    await assertRejects(() => failed, Error, 'bucket')
    return sharing(kept, 'k', () => Promise.resolve('copy'))
  })
  assertEquals(await result, 'copy')
})

test('a single flight can run again after completion within the same request', async () => {
  let group = {}
  let runs = 0
  let ask = () => inFlight(group, 'k', () => Promise.resolve(++runs))
  let { result } = asking(async () => [
    await Promise.all([ask(), ask()]),
    await ask(),
  ])
  assertEquals(await result, [[1, 1], 2])
})

test('a limit keeps the most recently used completed keys', async () => {
  let kept = new Map<string, string>()
  for (let k of ['a', 'b', 'a', 'c']) {
    await sharing(kept, k, () => Promise.resolve(k), 2)
  }
  assertEquals([...kept.keys()], ['a', 'c'])
})

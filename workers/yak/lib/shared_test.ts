// A read an isolate's requests share (shared.ts): one read for every ask, a
// failure kept by nobody, the starter holding it to its end, and a limit.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { within } from '../defects.ts'
import { sharing } from './shared.ts'

// A read that answers when told, and how many times it was begun.
let reader = () => {
  let begun = 0, answer = (_: string) => {}, fail = (_: Error) => {}
  let read = () => {
    begun++
    return new Promise<string>((yes, no) => (answer = yes, fail = no))
  }
  return {
    read,
    begun: () => begun,
    answer: (s: string) => answer(s),
    fail: (e: Error) => fail(e),
  }
}

// What the request held open past its answer (defects.ts `background`).
let asking = <T>(run: () => T) => {
  let held: Promise<void>[] = []
  let result = within({}, {}, run, undefined, { retain: (w) => held.push(w) })
  return { result, held }
}

test('every ask shares one read, and the first asker holds it to its end', async () => {
  let kept = new Map<string, Promise<string>>()
  let r = reader()
  let first = asking(() => sharing(kept, 'k', r.read))
  let second = asking(() => sharing(kept, 'k', r.read))
  assertEquals(r.begun(), 1)
  assertEquals([first.held.length, second.held.length], [1, 0])
  let settled = false
  first.held[0].then(() => settled = true)
  await Promise.resolve()
  assertEquals(settled, false)
  r.answer('copy')
  assertEquals(await second.result, 'copy')
  await first.held[0]
  assertEquals(await sharing(kept, 'k', r.read), 'copy')
  assertEquals(r.begun(), 1)
})

test('a failed read is kept by nobody: the next ask reads again', async () => {
  let kept = new Map<string, Promise<string>>()
  let r = reader()
  let failed = sharing(kept, 'k', r.read)
  r.fail(new Error('bucket'))
  await assertRejects(() => failed, Error, 'bucket')
  let again = sharing(kept, 'k', r.read)
  r.answer('copy')
  assertEquals([await again, r.begun()], ['copy', 2])
})

test('a limit keeps the newest asked keys', () => {
  let kept = new Map<string, Promise<string>>()
  for (let k of ['a', 'b', 'a', 'c']) {
    sharing(kept, k, () => Promise.resolve(k), 2)
  }
  assertEquals([...kept.keys()], ['a', 'c'])
})

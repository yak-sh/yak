// Subscribing a browser while its push service refuses for a while.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { persist, tidy, Unallowed } from './browser.ts'

// The browser's push service refusing a subscription for a while (bug
// a0001c73): the page tries again later and says so once.
let refused = () =>
  new DOMException('Registration failed - push service error', 'AbortError')

let run = (answers: (string | Error)[]) => {
  let slept: number[] = []
  let said = 0
  let attempt = () => {
    let answer = answers.shift()!
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer)
  }
  let done = persist(attempt, {
    waits: [1, 2, 3],
    sleep: (ms) => Promise.resolve(void slept.push(ms)),
    waiting: () => said++,
  })
  return { done, slept, said: () => said }
}

test('persist tries again while the push service refuses, saying so once', async () => {
  let r = run([refused(), refused(), 'sub'])
  assertEquals(await r.done, 'sub')
  assertEquals(r.slept, [1, 2])
  assertEquals(r.said(), 1)
})

test('persist answers at once when the push service takes it', async () => {
  let r = run(['sub'])
  assertEquals(await r.done, 'sub')
  assertEquals([r.slept, r.said()], [[], 0])
})

test('persist gives up with a refusal the person reads', async () => {
  let r = run([refused(), refused(), refused(), refused()])
  await assertRejects(() => r.done, Unallowed, 'not answering')
  assertEquals(r.slept, [1, 2, 3])
})

test('persist passes any other failure through untried', async () => {
  let r = run([new DOMException('bad key', 'InvalidAccessError')])
  await assertRejects(() => r.done, DOMException, 'bad key')
  assertEquals(r.slept, [])
})

test('tidy asks nothing in a browser that keeps no notifications', async () => {
  let asked = false
  let serviceWorker = { getRegistration: () => Promise.resolve({}) }
  Object.defineProperty(navigator, 'serviceWorker', {
    value: serviceWorker,
    configurable: true,
  })
  try {
    await tidy(() => (asked = true, Promise.resolve([])))
  } finally {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
  }
  assertEquals(asked, false)
})

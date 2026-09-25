import { assertEquals } from '@std/assert'
import { tick } from './testing.ts'
import { type Body, kept } from './kept.ts'
import { bundle } from './bundle.ts'

let get = (handle: (r: Request) => Promise<Response>) =>
  handle(new Request('http://x/x'))

// Answers each make from the list in turn: a string is the body, an Error a
// failure, and `hang` a make that never settles (and notes being aborted).
let makes = (...plan: (string | Error | 'hang')[]) => {
  let seen = { tries: 0, aborted: false }
  let make = (signal: AbortSignal): Promise<Body> => {
    let next = plan[seen.tries++]
    if (next == 'hang') {
      signal.onabort = () => seen.aborted = true
      return new Promise(() => {})
    }
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  }
  return { seen, make }
}

Deno.test('a body that never comes is given up on, and made again', async () => {
  let { seen, make } = makes('hang', 'made')
  let handle = kept('/x', 'text/plain', make, { limit: 0 })
  assertEquals((await get(handle)).status, 500)
  assertEquals(seen.aborted, true)
  assertEquals(await (await get(handle)).text(), 'made')
})

Deno.test('a body started early that fails is made again by the first request', async () => {
  let { seen, make } = makes(new Error('no'), 'made')
  let handle = kept('/x', 'text/plain', make, { early: true })
  await tick()
  assertEquals(await (await get(handle)).text(), 'made')
  assertEquals(seen.tries, 2)
})

Deno.test('a body once made is kept', async () => {
  let { seen, make } = makes('made')
  let handle = kept('/x', 'text/plain', make)
  await get(handle)
  assertEquals(await (await get(handle)).text(), 'made')
  assertEquals(seen.tries, 1)
})

Deno.test('a stopped bundle stops the bundler', async () => {
  let stop = new AbortController()
  let built = bundle(stop.signal)
  stop.abort()
  let why = await built.then(() => '', (e: Error) => e.message)
  assertEquals(why, 'deno bundle was stopped')
})

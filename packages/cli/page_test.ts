import { test, tick } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Body, type Build, compiled, kept } from './page.ts'

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

test('a body that never comes is given up on, and made again', async () => {
  let { seen, make } = makes('hang', 'made')
  let handle = kept('/x', 'text/plain', make, { limit: 0 })
  assertEquals((await get(handle)).status, 500)
  assertEquals(seen.aborted, true)
  assertEquals(await (await get(handle)).text(), 'made')
})

test('a body started early that fails is made again by the first request', async () => {
  let { seen, make } = makes(new Error('no'), 'made')
  let handle = kept('/x', 'text/plain', make, { early: true })
  await tick()
  assertEquals(await (await get(handle)).text(), 'made')
  assertEquals(seen.tries, 2)
})

test('a make still going when its host closes is ended', async () => {
  let { seen, make } = makes('hang')
  let closing = new AbortController()
  let handle = kept('/x', 'text/plain', make, { closing: closing.signal })
  let answer = get(handle)
  closing.abort()
  await tick()
  assertEquals(seen.aborted, true)
  assertEquals((await answer).status, 500)
})

test('a body once made is kept, and revalidated by its hash', async () => {
  let { seen, make } = makes('made')
  let handle = kept('/x', 'text/plain', make)
  let first = await get(handle)
  assertEquals(await first.text(), 'made')
  let second = await get(handle)
  assertEquals(await second.text(), 'made')
  assertEquals(second.headers.get('etag'), first.headers.get('etag'))
  let again = await handle(
    new Request('http://x/x', {
      headers: { 'if-none-match': first.headers.get('etag')! },
    }),
  )
  assertEquals([again.status, seen.tries], [304, 1])

  let bytes = new TextEncoder().encode('made')
  let binary = kept('/x', 'text/plain', () => Promise.resolve(bytes))
  let before = await get(binary)
  let tag = before.headers.get('etag')!
  bytes.fill(0)
  let after = await get(binary)
  assertEquals(await after.text(), 'made')
  assertEquals(after.headers.get('etag'), tag)
  assertEquals(
    (await binary(
      new Request('http://x/x', {
        headers: { 'if-none-match': tag },
      }),
    )).status,
    304,
  )
})

let compiling = (rebuild: Build['rebuild']) => {
  let seen = { cancelled: 0, disposed: 0 }
  let build: Build = {
    rebuild,
    cancel: () => {
      seen.cancelled++
      return Promise.resolve()
    },
    dispose: () => {
      seen.disposed++
      return Promise.resolve()
    },
  }
  return { seen, build }
}

test('a completed build releases its context and ignores later cancellation', async () => {
  let stop = new AbortController()
  let { seen, build } = compiling(() =>
    Promise.resolve({ outputFiles: [{ text: 'built' }] })
  )
  assertEquals(await compiled(build, stop.signal), 'built')
  stop.abort()
  assertEquals(seen, { cancelled: 0, disposed: 1 })
})

test('a cancelled build releases its context without returning its output', async () => {
  let stop = new AbortController()
  let done!: (value: { outputFiles: { text: string }[] }) => void
  let { seen, build } = compiling(() =>
    new Promise((resolve) => {
      done = resolve
    })
  )
  let answer = compiled(build, stop.signal).catch((e) => e.message)
  stop.abort()
  done({ outputFiles: [{ text: 'incomplete' }] })
  assertEquals(await answer, 'browser bundle was stopped')
  assertEquals(seen, { cancelled: 1, disposed: 1 })
})

test('a failed build releases its context', async () => {
  let { seen, build } = compiling(() => Promise.reject(new Error('broken')))
  assertEquals(await compiled(build).catch((e) => e.message), 'broken')
  assertEquals(seen.disposed, 1)
})

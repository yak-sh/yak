import { test, tick } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  ahead,
  type Body,
  type Build,
  bundle,
  compiled,
  keep,
  kept,
} from './page.ts'
import { close } from './held.ts'

let get = (handle: (r: Request) => Promise<Response>) =>
  handle(new Request('http://x/x'))

// Answers each make from the list in turn: a string is the body, an Error a
// failure, and `hang` a make that settles only once aborted (and notes it).
let makes = (...plan: (string | Error | 'hang')[]) => {
  let seen = { tries: 0, aborted: false }
  let make = (signal: AbortSignal): Promise<Body> => {
    let next = plan[seen.tries++]
    if (next == 'hang') {
      return new Promise((_, reject) =>
        signal.onabort = () => {
          seen.aborted = true
          reject(new Error('aborted'))
        }
      )
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

test('a closing process lets a make it stopped settle, and leaves one still going', async () => {
  let ended = (closing: Promise<void>) => {
    let done = false
    void closing.then(() => done = true)
    return async () => (await tick(), done)
  }
  let going = Promise.withResolvers<Body>()
  let answer = get(kept('/x', 'text/plain', () => going.promise))
  assertEquals(await ended(close())(), true)
  going.resolve('made')
  assertEquals(await (await answer).text(), 'made')

  let stopped = Promise.withResolvers<Body>()
  let given = get(kept('/x', 'text/plain', () => stopped.promise, { limit: 0 }))
  assertEquals((await given).status, 500)
  let closed = ended(close())
  assertEquals(await closed(), false)
  stopped.reject(new Error('stopped'))
  assertEquals(await closed(), true)
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

test('a bundled page compiles its JSX against Preact', async () => {
  let path = await Deno.makeTempFile({
    dir: new URL('./', import.meta.url).pathname,
    prefix: '.page-',
    suffix: '.tsx',
  })
  try {
    await Deno.writeTextFile(path, 'export let page = <><b>hi</b></>\n')
    let code = await bundle(new URL(`file://${path}`))
    assertEquals(code.includes('React'), false)
    assertEquals(code.includes('hi'), true)
  } finally {
    await Deno.remove(path)
  }
})

test('a body made ahead is found under its key, and only there', async () => {
  let dir = new URL(`file://${await Deno.makeTempDir()}/made/`)
  try {
    await keep(dir, 'canvas', 'made')
    assertEquals(await ahead('canvas', dir), 'made')
    assertEquals(await ahead('other', dir), undefined)
  } finally {
    await Deno.remove(new URL('../', dir), { recursive: true })
  }
})

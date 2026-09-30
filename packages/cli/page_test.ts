import { test, tick } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Body, bundle, kept, sweep } from './page.ts'

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
  let again = await handle(
    new Request('http://x/x', {
      headers: { 'if-none-match': first.headers.get('etag')! },
    }),
  )
  assertEquals([again.status, seen.tries], [304, 1])
})

test('a stopped bundle stops the bundler', async () => {
  let stop = new AbortController()
  let built = bundle(new URL('./page.ts', import.meta.url), stop.signal)
  stop.abort()
  let why = await built.then(() => '', (e: Error) => e.message)
  assertEquals(why, 'deno bundle was stopped')
})

// A pid that named a process a moment ago and names none now.
let gone = async () => {
  let child = new Deno.Command('true').spawn()
  await child.status
  return child.pid
}

let there = (path: string) => Deno.stat(path).then(() => true, () => false)

test("a gone host's bundler is ended and its directory removed", async () => {
  let base = await Deno.makeTempDir()
  let dead = `${base}/yaks-page-${await gone()}-a`
  let mine = `${base}/yaks-page-${Deno.pid}-b`
  await Deno.mkdir(dead)
  await Deno.mkdir(mine)
  // Stands in for a bundler still writing into the dead host's directory.
  await Deno.writeTextFile(`${dead}/app.js`, 'setTimeout(() => {}, 60_000)')
  let left = new Deno.Command(Deno.execPath(), {
    args: ['run', `${dead}/app.js`],
  }).spawn()
  try {
    await sweep(base)
    assertEquals((await left.status).signal, 'SIGKILL')
    assertEquals(await there(dead), false)
    assertEquals(await there(mine), true)
  } finally {
    try {
      left.kill('SIGKILL')
    } catch { /* already ended */ }
    await Deno.remove(base, { recursive: true })
  }
}, { skip: Deno.build.os != 'linux' })

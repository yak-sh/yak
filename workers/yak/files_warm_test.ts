// A release's warm asks the cache for its files once and fills it, and a
// cache that fails or holds an answer back costs it nothing (T-152883).
import { test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { assertEquals } from '@std/assert'
import { at } from './cache.ts'
import { warm } from './files.ts'
import { platform } from './serving-probe.ts'

let eid = '11111111-1111-4111-8111-111111111111'
let source = 'ada/.releases/r1'
let paths = ['index.html', 'a.png', 'b.png', 'c.png']

// A warm over a cache that answers each address as `answer` says, and what
// it asked, reported and read from the bucket.
let warmed = async (answer: (req: Request) => Promise<Response>) => {
  await using scenario = platform()
  let { env, files } = scenario
  let asked: string[] = [], rows: Bundle[] = []
  env.ERRORS = {
    send: (batch: Bundle[]) => Promise.resolve(void rows.push(...batch)),
  }
  env.FILES = {
    fetch: (req) => (asked.push(req.url), answer(req)),
  }
  await warm(env, eid, source, paths, 20)
  return {
    asked: asked.sort(),
    reported: rows.length,
    // Of the files, not the release's config the warm reads first.
    read: files.gets.filter((g) => !g.key.includes('/wrangler.')).length,
  }
}

let all = ['/', '/a.png', '/b.png', '/c.png'].map((p) => at(eid, p, source))
  .sort()
let bytes = () => Promise.resolve(new Response('bytes'))
let hung = <T>(req: Request) =>
  new Promise<T>((_, reject) =>
    req.signal.addEventListener('abort', () => reject(req.signal.reason))
  )

test('a warm asks the cache for each file once', async () => {
  assertEquals(await warmed(bytes), { asked: all, reported: 0, read: 0 })
})

test('a warm leaves what the cache fails for its view', async () => {
  let failing = (req: Request) =>
    req.url.includes('/a.png')
      ? Promise.resolve(new Response(null, { status: 520 }))
      : req.url.includes('/b.png')
      ? Promise.reject(new Error('network lost'))
      : req.url.includes('/c.png')
      ? hung<Response>(req)
      : bytes()
  assertEquals(await warmed(failing), { asked: all, reported: 0, read: 0 })
})

test('a body the cache stops sending is given up at the deadline', async () => {
  let stalled = (req: Request) =>
    Promise.resolve(
      new Response(new ReadableStream({ pull: () => hung<void>(req) })),
    )
  assertEquals(await warmed(stalled), { asked: all, reported: 0, read: 0 })
})

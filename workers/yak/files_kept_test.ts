// What the platform keeps about an app under a name written once, such as a
// release's declaration, is read through the cached Files door: a fresh
// isolate finds it in the cache instead of the bucket.
import { clock, test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { keptAt } from '@yaks/platform/kept'
import { fetch, keptBytes, PREFIX } from './files.ts'
import { declarationOf, keepDeclaration } from './declaration.ts'
import { platform } from './serving-probe.ts'
import type { App, Space } from './directory.ts'
import { type Tally, tallying } from './lib/hops.ts'

let { env, files } = platform()
let calls: Request[] = []
env.FILES = {
  fetch: (req) => {
    calls.push(req)
    return fetch(req, env)
  },
}
let eid = crypto.randomUUID()
let prefix = `ada/.declarations/${eid}/`

test('a kept object is read through the cache, and nothing kept is not kept', async () => {
  files.held.set(prefix + 'v1/r1.json', new TextEncoder().encode('{}'))
  assertEquals(
    new TextDecoder().decode(
      (await keptBytes(env, { eid }, prefix, 'v1/r1.json'))!,
    ),
    '{}',
  )
  assertEquals(calls.at(-1)!.url, keptAt(eid, 'v1/r1.json'))
  assertEquals(calls.at(-1)!.headers.get(PREFIX), prefix)
  assertEquals(await keptBytes(env, { eid }, prefix, 'v1/none.json'), null)
  let absent = await fetch(
    new Request(keptAt(eid, 'v1/none.json'), {
      headers: { [PREFIX]: prefix },
    }),
    env,
  )
  assertEquals(absent.headers.get('cache-control'), 'private, no-store')
})

test('a slow cache gives way to one bucket read, even when R2 takes over five seconds', async () => {
  await using scenario = platform()
  let { env, files } = scenario
  let time = env.CLOCK = clock()
  let match = Promise.withResolvers<Response | undefined>()
  let read = Promise.withResolvers<void>()
  let gets = 0, fills = 0
  let get = env.BLOBS.get.bind(env.BLOBS)
  env.BLOBS.get = async (...args) => {
    gets++
    await read.promise
    return get(...args)
  }
  env.FILE_CACHE = () =>
    Promise.resolve({
      match: () => match.promise,
      put: () => Promise.resolve(void fills++),
    })
  let name = 'slow/1.json'
  files.held.set(prefix + name, new TextEncoder().encode('{}'))

  let answer = keptBytes(env, { eid }, prefix, name)
  await time.advance(499)
  assertEquals(gets, 0)
  await time.advance(1)
  assertEquals(gets, 1)
  await time.advance(5_000)
  assertEquals(gets, 1)

  match.resolve(undefined)
  read.resolve()
  assertEquals(new TextDecoder().decode((await answer)!), '{}')
  assertEquals([gets, fills], [1, 0])
})

test('a declaration another isolate kept is read through Files, once', async () => {
  let space = { slug: 'ada', store: 'ada' } as Space
  let app = {
    eid,
    slug: 'notes',
    source: 'ada/notes/.releases/v3',
    version: 2,
  } as unknown as App
  let value = { vocab: { $defs: { note: {} } }, tools: {} }
  // Kept by another isolate: this one reads the bytes it never held.
  files.held.set(
    prefix + 'v3/2.json',
    new TextEncoder().encode(JSON.stringify(value)),
  )
  let tally: Tally = new Map()
  let read = () => tallying(tally, () => declarationOf(env, space, app))
  assertEquals(await read(), value)
  assertEquals(await read(), value)
  assertEquals(tally.get('files'), 1)
})

test('a declaration is read through Files behind its write, so the cache holds it', async () => {
  let space = { slug: 'ada', store: 'ada' } as Space
  let app = { eid, slug: 'notes', source: 'ada/notes/.releases/v4' } as App
  let before = calls.length
  let asked = new Promise<Request>((done) => {
    let { fetch: was } = env.FILES!
    env.FILES = {
      fetch: (req) => (done(req), env.FILES = { fetch: was }, was(req)),
    }
  })
  await keepDeclaration(env, space, app, 'r5', { vocab: {}, tools: {} })
  assertEquals((await asked).url, keptAt(eid, 'v4/r5.json'))
  assertEquals(calls.length, before + 1)
})

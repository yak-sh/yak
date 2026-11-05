// What the platform keeps about an app under a name written once, such as a
// release's declaration, is read through the cached Files door: a fresh
// isolate finds it in the cache instead of the bucket.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { keptAt } from './cache.ts'
import { fetch, keptBytes, PREFIX } from './files.ts'
import { declarationOf } from './declaration.ts'
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

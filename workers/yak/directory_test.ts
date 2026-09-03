// The directory's read cache, and the one read that must not use it. Every
// kernel part asks the directory who a space is and what an app is, and the
// answers are cached per isolate for 30 seconds — cheap, and stale for at
// most that long. A deploy opens exactly that window: the isolate serving the
// app has not heard of the version bump, so a break in those seconds named
// the deploy BEFORE the one it happened on (C-32869 item 4). A break is rare,
// so the report path asks fresh.
import { assertEquals } from '@std/assert'
import * as dirPart from './directory.ts'
import { directory, type Space } from './directory.ts'
import type { Env } from './env.ts'

let space: Space = {
  eid: 's1',
  slug: 'jeff',
  home: null,
  title: 'jeff',
  tier: null,
  plan: null,
  meter: null,
  told: false,
}

// A meta store that answers one app, at whatever version the test has set.
let stub = () => {
  let at = { version: 1, reads: 0 }
  let env = {
    STORE: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: (r: Request) => {
          let url = new URL(r.url)
          // The boot seed asks whether the meta space exists; it does.
          if (url.search.includes('space.slug')) {
            return Response.json([
              { entity: { eid: 'm1', num: 1 }, space: { slug: 'yak' } },
            ])
          }
          at.reads++
          return Response.json([{
            entity: { eid: 'a1', num: 2 },
            app: { slug: 'recipes', space: 's1', version: at.version },
          }])
        },
      }),
    },
  } as unknown as Env
  return {
    at,
    dir: directory({ fetch: (r: Request) => dirPart.fetch(r, env) }),
  }
}

// A hostname someone else owns, resolved to the app it serves and the space
// that app is in (T-33037) — the read index.ts makes before it falls back to
// the apex. A hostname nobody attached answers null, which is what keeps
// every address that exists today routing as it always has.
let hosts = () => {
  let env = {
    STORE: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: (r: Request) => {
          let q = decodeURIComponent(new URL(r.url).search)
          if (q.includes('space.slug')) {
            return Response.json([
              { entity: { eid: 'm1', num: 1 }, space: { slug: 'yak' } },
            ])
          }
          if (q.includes('hostname.name=herbusiness.com')) {
            return Response.json([{
              entity: { eid: 'd1', num: 3 },
              hostname: { name: 'herbusiness.com', app: 'a1' },
            }])
          }
          if (q.includes('id=a1')) {
            return Response.json([{
              entity: { eid: 'a1', num: 2 },
              app: { slug: 'recipes', space: 's1', version: 1 },
            }])
          }
          if (q.includes('id=s1')) {
            return Response.json([{
              entity: { eid: 's1', num: 1 },
              space: { slug: 'jeff', home: null },
            }])
          }
          return Response.json([])
        },
      }),
    },
  } as unknown as Env
  return directory({ fetch: (r: Request) => dirPart.fetch(r, env) })
}

Deno.test('a hostname resolves to its space and app, or to nobody', async () => {
  let dir = hosts()
  let at = await dir.serves('herbusiness.com')
  assertEquals([at?.space.slug, at?.app.slug], ['jeff', 'recipes'])
  assertEquals(at?.host.name, 'herbusiness.com')
  assertEquals(await dir.serves('elsewhere.com'), null)
})

Deno.test('a fresh read goes past the 30-second cache, and refills it', async () => {
  let { at, dir } = stub()
  assertEquals((await dir.app(space, 'recipes'))?.version, 1)
  at.version = 2
  // An ordinary read is the cached one — this is what the ninth user test's
  // first break named.
  assertEquals((await dir.app(space, 'recipes'))?.version, 1)
  assertEquals(at.reads, 1)
  // The read a break makes says what the app is serving now.
  assertEquals((await dir.app(space, 'recipes', true))?.version, 2)
  assertEquals(at.reads, 2)
  // And it leaves the cache holding what it just learned, so the next
  // ordinary read is not stale either.
  at.version = 3
  assertEquals((await dir.app(space, 'recipes'))?.version, 2)
  assertEquals(at.reads, 2)
})

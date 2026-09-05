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

// A comp is the platform holding one of its own spaces to no ceiling. It is a
// constant read here and a column nowhere: what makes that safe is that
// nothing on the wire can reach it, which is the same reason `plan` is
// stamped (billing.ts).
Deno.test('a comped space reads as plus, everyone else as what they pay', () => {
  assertEquals(dirPart.tierOf('yourname', null), 'plus')
  assertEquals(dirPart.tierOf('yourname', 'free'), 'plus')
  assertEquals(dirPart.tierOf('jeff', null), null)
  assertEquals(dirPart.tierOf('jeff', 'free'), 'free')
  assertEquals(dirPart.tierOf('jeff', 'plus'), 'plus')
})

// A meta store that keeps what it is written, so the questions `own()` asks
// — who this person is, what they own, whether a slug is taken — answer
// differently after it writes. Only the filters `own()` and `spaces()` use
// are understood; anything else answers nothing.
type Held = { entity: { eid: string; num: number }; [comp: string]: unknown }

let held = () => {
  let rows: Held[] = []
  let num = 0
  let put = (eid: string, comps: Record<string, unknown>) => {
    let row = rows.find((r) => r.entity.eid == eid)
    if (!row) rows.push(row = { entity: { eid, num: ++num } })
    for (let [name, comp] of Object.entries(comps)) {
      row[name] = { ...(row[name] as object ?? {}), ...(comp as object) }
    }
    return row
  }
  // A filter is ANDed terms; a `?` term only asks for a component to ride
  // along, so it screens nothing.
  let answer = (search: string) => {
    let terms = decodeURIComponent(search.slice(1)).split('&')
      .filter((t) => t && !t.endsWith('?'))
    return rows.filter((row) =>
      terms.every((t) => {
        let [key, want] = t.split('=')
        if (key == '.eid') return row.entity.eid == want
        if (key == '.limit' || key == '.after') return true
        let [, name, col] = key.split('.')
        let comp = row[name] as Record<string, unknown> | undefined
        return col ? comp?.[col] == want : !!comp
      })
    )
  }
  let apply = (body: string) => {
    let { entities } = JSON.parse(body) as {
      entities: Record<string, unknown>[]
    }
    let alias: Record<string, string> = {}
    let named = (v: unknown) =>
      typeof v == 'string' && v.startsWith('$') ? alias[v] : v
    for (let e of entities) {
      let { entity, ...comps } = e as {
        entity?: { eid: string }
        [k: string]: unknown
      }
      let want = entity?.eid
      let eid = want?.startsWith('$')
        ? (alias[want] ??= crypto.randomUUID())
        : want ?? crypto.randomUUID()
      let slug = (comps.space as { slug?: string } | undefined)?.slug
      // The unique slug, which is what a losing race bounces on.
      if (
        slug && rows.some((r) => (r.space as { slug?: string })?.slug == slug)
      ) {
        return new Response('slug taken', { status: 409 })
      }
      for (let comp of Object.values(comps)) {
        let cols = comp as Record<string, unknown>
        for (let [k, v] of Object.entries(cols)) cols[k] = named(v)
      }
      put(eid, comps)
    }
    return Response.json({ changes: [], aliases: alias })
  }
  let env = {
    STORE: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async (r: Request) => {
          let url = new URL(r.url)
          if (url.pathname == '/apply') return apply(await r.text())
          return Response.json(answer(url.search))
        },
      }),
    },
  } as unknown as Env
  return {
    put,
    dir: directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true),
  }
}

Deno.test("a person's own space is one they own, not one they were invited to", async () => {
  let m = held()
  let inviter = crypto.randomUUID()
  let guest = crypto.randomUUID()
  m.put(inviter, { person: {}, email: { address: 'dana@yaks.app' } })
  m.put(guest, { person: {}, email: { address: 'ana@yaks.app' } })
  let theirs = await m.dir.own(inviter)
  assertEquals(theirs.slug, 'dana')
  // Invited into it as an editor before ever signing in.
  m.put(crypto.randomUUID(), {
    member: { space: theirs.eid, person: guest, role: 'editor' },
  })
  assertEquals((await m.dir.spaces(guest)).map((s) => s.slug), ['dana'])
  assertEquals(await m.dir.spaces(guest, 'owner'), [])
  // Their own is minted, and it is not the inviter's.
  let mine = await m.dir.own(guest)
  assertEquals(mine.slug, 'ana')
  assertEquals(await m.dir.role(mine, guest), 'owner')
  // Asking again is that same space, not a second one.
  assertEquals((await m.dir.own(guest)).eid, mine.eid)
})

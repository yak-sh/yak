// Directory reads through its cache and the serving app roster that must be
// fresh and coherent across apps in one request.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { Stale } from '@yaks/graph/errors'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { matcher } from '@yaks/match'
import type { Bundle, Tx } from '@yaks/graph'
import { platformVocab } from './vocab.ts'
import { plugins } from './facets/directory-graph.ts'
import * as dirPart from './directory.ts'
import { type App, directory, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { READS } from './directory-copy.ts'
import { tallying } from './lib/hops.ts'
import { answered, type Meta, metaOf } from './meta.ts'
import { doorOf, STATIC_QUERY } from './door.ts'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { EPOCH } from './directory-copy.ts'
import { Pending } from './writes.ts'

let fixture = (store: Meta) => {
  let fetch = dirPart.over(store)
  return {
    fetch: async (req: Request) => {
      let answer = await fetch(req)
      answer.headers.set(EPOCH, '0')
      return answer
    },
  }
}
let rows = (body: unknown) => Response.json(body, { headers: { [EPOCH]: '0' } })

test('a typed directory read keeps the local transport and its revision', async () => {
  let requests: Request[] = []
  let META = metaOf(doorOf((req) => {
    requests.push(req)
    return Promise.resolve(Response.json([], { headers: { [EPOCH]: '17' } }))
  }, PLATFORM_STORE))
  let env = {
    META,
    STORE: {
      idFromName: (name: string) => name,
      get: () => {
        throw new Error('the directory called its own stub')
      },
    },
  }
  let via = { fetch: (req: Request) => dirPart.fetch(req, env) }
  assertEquals(await directory(via).all(), [])
  let answer = await via.fetch(
    new Request('http://directory/query?q=.space', {
      headers: { [EPOCH]: '1', [STATIC_QUERY]: '1' },
    }),
  )
  assertEquals(await answer.json(), [])
  assertEquals(answer.headers.get(EPOCH), '17')
  assertEquals(requests.length, 2)
  assert(requests.every((req) => req.headers.get(STATIC_QUERY) == '1'))
})

let space: Space = {
  eid: 's1',
  slug: 'jeff',
  store: 'jeff',
  title: 'jeff',
  operator: 'Wren',
  tier: null,
  plan: null,
  seller: null,
  fee: 0,
  budget: null,
  meter: null,
  told: false,
  trashed: null,
  slugs: [],
  tunnel: null,
}

let an: App = {
  policy: 0,
  eid: 'a1',
  slug: 'recipes',
  space: 's1',
  version: 1,
  title: 'Recipes',
  access: 'public',
  store: null,
  slugs: ['recipes'],
  home: false,
  first: [],
  meter: null,
  published: null,
  installed: null,
  gallery: null,
  screenshot: null,
  seeded: null,
  trashed: null,
  theme: null,
}

test('release assets belong to deployed and remade sources of their own app', async () => {
  let source = 'jeff.1f7c3e/.releases/a1/'
  let vocab = platformVocab()
  let held: Bundle[] = [
    {
      entity: { eid: 'd1' },
      deploy: { app: an.eid, source: source + 'live', version: 1 },
    },
    {
      entity: { eid: 's1' },
      switched: { app: an.eid, source: source + 'remade' },
    },
    {
      entity: { eid: 's2' },
      switched: { app: 'another-app', source: source + 'another' },
    },
  ]
  let dir = directory({
    fetch: (req: Request) => {
      let q = new URL(req.url).searchParams.get('q') ?? ''
      return Promise.resolve(rows(matcher(q, vocab)(held)))
    },
  })
  assertEquals(await dir.released(an, source + 'live'), true)
  assertEquals(await dir.released(an, source + 'remade'), true)
  assertEquals(await dir.released(an, source + 'failed'), false)
  assertEquals(await dir.released(an, source + 'another'), false)
})

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
            if (url.search.includes('space.slug%3Djeff')) {
              at.reads++
              return rows([{
                entity: { eid: 's1', num: 1 },
                space: { slug: 'jeff', store: 'jeff' },
              }])
            }
            return rows([
              {
                entity: { eid: 'm1', num: 1 },
                space: { slug: 'yak', store: 'yak' },
              },
            ])
          }
          at.reads++
          return rows([{
            entity: { eid: 'a1', num: 2 },
            app: { slug: 'recipes', space: 's1', version: at.version },
          }])
        },
      }),
    },
  } as unknown as Env
  return {
    at,
    dir: directory({ fetch: (req) => dirPart.fetch(req, env) }),
  }
}

// A hostname someone else owns, resolved to the place it serves (T-33037,
// T-34596) — the read index.ts makes before it falls back to the apex. One
// aimed at an app answers that app and the space it is in; one aimed at the
// space answers the space with no app, which is how `aimed` knows to leave the
// path alone. A hostname nobody attached answers null, which is what keeps
// every address that exists today routing as it always has.
let hosts = () =>
  directory(fixture({
    query: (q) => {
      let rows = q.includes('hostname.name=herbusiness.com')
        ? [{
          entity: { eid: 'd1', num: 3 },
          hostname: { name: 'herbusiness.com', serves: 'a1' },
        }]
        : q.includes('hostname.name=ourbookclub.com')
        ? [{
          entity: { eid: 'd2', num: 4 },
          hostname: { name: 'ourbookclub.com', serves: 's1' },
        }]
        : q.includes('.app.space=s1') || q.includes('.entity.eid=a1')
        ? [{
          entity: { eid: 'a1', num: 2 },
          app: { slug: 'recipes', space: 's1', version: 1 },
        }]
        : q.includes('.entity.eid=s1')
        ? [{
          entity: { eid: 's1', num: 1 },
          space: { slug: 'jeff', store: 'jeff' },
        }]
        : []
      return Promise.resolve(rows)
    },
    apply: () => Promise.resolve([]),
  }))

test('a hostname resolves to its space and app, or to nobody', async () => {
  let dir = hosts()
  let at = await dir.serves('herbusiness.com')
  assertEquals([at?.space.slug, at?.app?.slug], ['jeff', 'recipes'])
  assertEquals(at?.host.name, 'herbusiness.com')
  assertEquals(await dir.serves('elsewhere.com'), null)
})

test('a hostname on the space resolves to the space, with no app', async () => {
  let dir = hosts()
  let at = await dir.serves('ourbookclub.com')
  assertEquals(at?.space.slug, 'jeff')
  assertEquals(at?.app, null)
  assertEquals(at?.host.serves, 's1')
})

test('an app read selects the current release', async () => {
  let { at, dir } = stub()
  assertEquals((await dir.app(space, 'recipes'))?.version, 1)
  at.version = 2
  assertEquals((await dir.app(space, 'recipes'))?.version, 2)
  assertEquals(at.reads, 2)
})

test('a release reaches consumer and home through stale isolate caches', async () => {
  let version = 1
  let reads = [0, 0]
  let isolate = (i: number) => {
    let store: Meta = {
      query: (line) => {
        reads[i]++
        if (!line.includes('.app.space=s1')) return Promise.resolve([])
        return Promise.resolve(['consumer', 'home'].map((slug) => ({
          entity: { eid: slug },
          app: {
            slug,
            space: 's1',
            version: slug == 'consumer' ? version : 1,
            declaration: `${slug}-${version}`,
          },
          ...(slug == 'home' ? { home: {} } : {}),
        })))
      },
      apply: () => Promise.resolve([]),
    }
    let via = fixture(store)
    return { dir: directory(via), another: () => directory(via) }
  }
  let first = isolate(0)
  let second = isolate(1)
  // Both isolates still hold v1 in their 30-second caches when the directory
  // commits the consumer release and home declaration together.
  await first.dir.apps(space)
  await second.dir.apps(space)
  version = 2
  await tallying(new Map(), async () => {
    let { app: consumer, home } = await first.dir.routing(space, 'consumer')
    assertEquals([consumer?.declaration, home?.declaration], [
      'consumer-2',
      'home-2',
    ])
  })
  await tallying(new Map(), async () => {
    let home = await second.dir.home(space)
    let consumer = await second.another().app(space, 'consumer')
    assertEquals([consumer?.declaration, home?.declaration], [
      'consumer-2',
      'home-2',
    ])
  })
  // Every app read reaches the directory: routing's one, then home's and the
  // app's own.
  assertEquals(reads, [2, 3])
})

test('a request answers an app from its first read until it asks again', async () => {
  let fence: string | null = '1:release'
  let store: Meta = {
    query: (line) =>
      Promise.resolve(
        line.includes('.app.slug=notes')
          ? [{
            entity: { eid: 'a1' },
            app: { slug: 'notes', space: 's1', fence },
          }]
          : [],
      ),
    apply: () => Promise.resolve([]),
  }
  let dir = directory(fixture(store))
  await tallying(new Map(), async () => {
    assertEquals((await dir.app(space, 'notes'))?.fence, '1:release')
    // Another request's release lifts the fence.
    fence = null
    assertEquals((await dir.app(space, 'notes'))?.fence, '1:release')
    dir.reread()
    assertEquals((await dir.app(space, 'notes'))?.fence, null)
  })
})

// Read real graph predicates so address/home filtering, not a stub's roster,
// determines which apps may route a path.
let routingVocab = platformVocab()
let routingGraph = graph({ storage: ram(routingVocab), vocab: routingVocab })
await routingGraph.apply([
  { entity: { eid: 's1' }, space: { slug: 'jeff', store: 'jeff' } },
  { entity: { eid: 's2' }, space: { slug: 'other', store: 'other' } },
  {
    entity: { eid: 's3' },
    space: { slug: 'trashed-home', store: 'trashed-home' },
  },
  ...[
    ['a1', 's1', 'recipes'],
    ['a2', 's1', 'front'],
    ['a3', 's2', 'recipes'],
    ['a4', 's3', 'front'],
  ].map(([eid, space, slug]) => ({
    entity: { eid },
    app: { space, slug, access: 'public', version: 1 },
    ...(eid != 'a1' ? { home: { first: '/recipes/*' } } : {}),
    ...(eid == 'a4' ? { trashed: { at: '2026-10-19T00:00:00Z' } } : {}),
  })),
], { trusted: true })
let routingDir = directory(fixture({
  query: (q) => routingGraph.read(q) as Promise<dirPart.Row[]>,
  apply: () => Promise.resolve([]),
}))

for (
  let [name, inSpace, slug, expected] of [
    ['explicit address', 's1', 'recipes', ['a1', 'a2']],
    ['missing address', 's1', 'missing', [null, 'a2']],
    ['no address', 's1', undefined, [null, 'a2']],
    ['empty address', 's1', '', [null, 'a2']],
    ['front page address', 's1', 'front', ['a2', 'a2']],
    ['another space', 's2', 'recipes', ['a3', 'a3']],
    ['trashed front page', 's3', undefined, [null, null]],
    ['explicit trashed address', 's3', 'front', ['a4', null]],
  ] as const
) {
  test(`directory routing: ${name}`, async () => {
    let { app, home } = await routingDir.routing(
      { ...space, eid: inSpace },
      slug,
    )
    assertEquals<readonly (string | null)[]>(
      [app?.eid ?? null, home?.eid ?? null],
      expected,
    )
  })
}

// A space's bare address is its front page or its listing, so the one read
// that routes it holds every app, in the order `apps` lists them.
for (
  let [name, slug, app, roster, home] of [
    ['bare address', 'jeff', undefined, ['a1', 'a2'], 'a2'],
    ['named address', 'jeff', 'recipes', null, 'a2'],
    ['trashed front page', 'trashed-home', undefined, ['a4'], null],
  ] as const
) {
  test(`directory page: ${name}`, async () => {
    let page = await routingDir.page(slug, app)
    assertEquals<unknown>(
      [page.roster?.map((a) => a.eid) ?? null, page.home?.eid ?? null],
      [roster, home],
    )
    if (page.roster) {
      assertEquals(page.roster, await routingDir.apps(page.space!))
    }
  })
}

// A page read names every app of its space, so asking them again in the same
// request costs no trip, until the request writes to the directory.
test('directory page: its apps answer the request again, until it writes', async () => {
  let asked = 0
  let dir = directory(fixture({
    query: (q) => (asked++, routingGraph.read(q) as Promise<dirPart.Row[]>),
    apply: () => Promise.resolve([]),
  }))
  await tallying(new Map(), async () => {
    let page = await dir.page('jeff')
    let read = asked
    assertEquals(await dir.apps(page.space!), page.roster)
    assertEquals(asked, read)
    await dir.apply({ entities: [{ entity: { eid: 'a1' }, doc: {} }] })
    read = asked
    await dir.apps(page.space!)
    assertEquals(asked, read + 1)
  })
})

// The invitations a page read found answer that request alone: one client
// serves every request of an isolate (`directoryOf`), and an invitation sent
// or withdrawn between two of them is the second one's news.
let inviting = async (before: boolean) => {
  let vocab = platformVocab()
  let g = graph({ storage: ram(vocab), vocab })
  let invite = { entity: { eid: 'i1' }, invite: { to: 's1', person: 'p1' } }
  await g.apply([
    { entity: { eid: 's1' }, space: { slug: 'jeff', store: 'jeff' } },
    { entity: { eid: 'p1' }, person: {} },
    ...before ? [invite] : [],
  ], { trusted: true })
  let dir = directory(fixture({
    query: (q) => g.read(q) as Promise<dirPart.Row[]>,
    apply: () => Promise.resolve([]),
  }))
  let asked = () => tallying(new Map(), () => dir.invite('s1', 'p1'))
  await tallying(new Map(), async () => {
    await dir.page('jeff', null, 'p1')
    await dir.invite('s1', 'p1')
  })
  await g.apply([before ? { ...invite, $delete: true } : invite], {
    trusted: true,
  })
  return (await asked())?.eid ?? null
}
for (
  let [name, before, after] of [['withdrawn', true, null], [
    'sent',
    false,
    'i1',
  ]] as const
) {
  test(`directory page: an invitation ${name} since another request's read is seen`, async () => {
    assertEquals(await inviting(before), after)
  })
}

// Platform-owned spaces retain their fixed exemption. Operational comps
// are granted through the platform-only door (comp_test.ts).
test('a comped space reads as plus, everyone else as what they pay', () => {
  assertEquals(dirPart.tierOf('yourname', null), 'plus')
  assertEquals(dirPart.tierOf('yourname', 'free'), 'plus')
  assertEquals(dirPart.tierOf('jeff', null), null)
  assertEquals(dirPart.tierOf('jeff', 'free'), 'free')
  assertEquals(dirPart.tierOf('jeff', 'plus'), 'plus')
})

// The app's handle (T-34657): the string the platform names everything it
// keeps for this app by, and the thing a rename — of the app, or of its space —
// must never move.
test('a handle reads as the app and is the app, not its address', () => {
  let eid = '9efd22a8-19a0-49b8-95f7-5ecec9385dac'
  // Legible in the dashboard, sorted under its space, with the key on the end.
  assertEquals(dirPart.handle(space, 'cookbook', eid), 'jeff/cookbook.385dac')
  // Two apps born at one address, a year apart, are two strings — which is why
  // an address can be freed at all (T-34659).
  let other = '06d952a9-b26b-4ecb-9ea7-841a96e2b1a9'
  assertEquals(dirPart.handle(space, 'cookbook', other), 'jeff/cookbook.e2b1a9')
  // And a rename is exactly the thing it does not answer to: the app moves, the
  // handle it was born with is what its store is still opened by.
  let app = { ...an, store: dirPart.handle(space, 'cookbook', eid) }
  assertEquals(dirPart.storeName(space, app), 'jeff/cookbook.385dac')
  assertEquals(
    dirPart.storeName({ ...space, slug: 'ada' }, { ...app, slug: 'kitchen' }),
    'jeff/cookbook.385dac',
  )
  // An app the backfill has not reached keeps answering to the name it already
  // had, which is what it was called before the property existed.
  assertEquals(dirPart.storeName(space, { ...an, store: null }), 'jeff/recipes')
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
  let vocab = platformVocab()
  let answer = (search: string) =>
    matcher(new URLSearchParams(search).get('q') ?? '', vocab)(rows as Bundle[])
  // A request the directory decides inside the write (`$own`) is decided by
  // its own hook, over these rows.
  let [decides] = plugins()
  let tx = { read: (q: string) => answer(`?q=${encodeURIComponent(q)}`) }
  let apply = async (body: string) => {
    let entities = await decides.authorize!(
      JSON.parse(body) as Bundle[],
      tx as unknown as Tx,
      undefined,
      { graph: {}, trusted: true },
    ) as unknown as Record<string, unknown>[]
    let alias: Record<string, string> = {}
    let named = (v: unknown) =>
      typeof v == 'string' && v.startsWith('$') ? alias[v] : v
    let out: Record<string, unknown>[] = []
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
        let props = comp as Record<string, unknown>
        for (let [k, v] of Object.entries(props)) props[k] = named(v)
      }
      let row = put(eid, comps)
      // The batch as applied, each minted bundle wearing the alias it was
      // written under — what the graph's `/apply` answers.
      out.push({ ...row, ...(want?.startsWith('$') ? { $alias: want } : {}) })
    }
    return Response.json(out)
  }
  // Every call that would be a round trip to the Durable Object deployed
  // (door.ts `storeOf`), counted — which is what `hops` below clamps.
  let hops: string[] = []
  let env = {
    STORE: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async (r: Request) => {
          let url = new URL(r.url)
          hops.push(`${r.method} ${url.pathname}${url.search}`)
          if (url.pathname == '/apply') return apply(await r.text())
          if (url.pathname == READS) {
            return Response.json(
              url.searchParams.getAll('q').map((q) => ({
                status: 200,
                epoch: '0',
                body: JSON.stringify(answer(`?q=${encodeURIComponent(q)}`)),
              })),
            )
          }
          return Response.json(answer(url.search), {
            headers: { [EPOCH]: '0' },
          })
        },
      }),
    },
  } as unknown as Env
  return {
    put,
    hops,
    dir: directory({ fetch: (r: Request) => dirPart.fetch(r, env) }),
  }
}

test("a person's own space is one they own, not one they were invited to", async () => {
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

// T-135921: a second owner of a church's space renamed their own away from
// their address, and settings opened on the church's.
test("a person's own space stays theirs after they rename it", async () => {
  let m = held()
  let jeff = crypto.randomUUID()
  let matt = crypto.randomUUID()
  m.put(jeff, { person: {}, email: { address: 'jeff@yaks.app' } })
  m.put(matt, { person: {}, email: { address: 'matt@yaks.app' } })
  let church = await m.dir.own(jeff)
  let mine = await m.dir.own(matt)
  m.put(crypto.randomUUID(), {
    member: { space: church.eid, person: matt, role: 'owner' },
  })
  m.put(mine.eid, { space: { slug: 'yoder' } })
  assertEquals((await m.dir.own(matt)).eid, mine.eid)
})

test("the starter is a person's once, on their first space", async () => {
  let m = held()
  let ana = crypto.randomUUID()
  let bo = crypto.randomUUID()
  m.put(ana, { person: {}, email: { address: 'ana@yaks.app' } })
  let first = await m.dir.own(ana)
  assertEquals(first.starter, null)
  let club = await m.dir.mint(ana, 'club', 'Club', {})
  assertEquals((await m.dir.space('club'))!.starter, 0)
  // Theirs went to the first, and stays theirs after it is gone.
  m.put(bo, { person: {}, email: { address: 'bo@yaks.app' } })
  m.put(bo, { started: { space: club } })
  assertEquals((await m.dir.own(bo)).starter, 0)
})

test('a seat from before the mark is marked at the space their address names', async () => {
  let m = held()
  let ana = crypto.randomUUID()
  m.put(ana, { person: {}, email: { address: 'ana@yaks.app' } })
  let other = m.put(crypto.randomUUID(), { space: { slug: 'club' } })
  let mine = m.put(crypto.randomUUID(), { space: { slug: 'ana' } })
  for (let space of [other, mine]) {
    m.put(crypto.randomUUID(), {
      member: { space: space.entity.eid, person: ana, role: 'owner' },
    })
  }
  assertEquals((await m.dir.own(ana)).eid, mine.entity.eid)
  m.put(mine.entity.eid, { space: { slug: 'anna' } })
  assertEquals((await m.dir.own(ana)).eid, mine.entity.eid)
})

// The clamp on how many round trips a sign-in costs (T-34138). Every question
// the kernel asks the directory is one fetch to the platform's Durable Object,
// and the sign-in flow asks them one after another — measured on the workerd
// stand-in, a first sign-in is 22 of them and a new person's `/login/code`
// alone is 11. On the deploy each one is a network hop, so the flow's wall
// time is very nearly the hop count times the round trip: adding latency per
// hop on the stand-in moved the whole flow by 21ms for every 1ms added.
//
// `own()` is the heaviest stretch of it and the likeliest to grow — a new
// question asked inside it is invisible to a test that only checks the answer
// — so the questions are counted. Reads here are fresh (`held` builds the
// client with the cache off), which is the honest worst case: what the deploy
// pays is this or less.
//
// A number that moves is not automatically wrong. It is a number somebody
// should have looked at, with the reason written down beside it.
test('signing in asks the directory a bounded number of questions', async () => {
  let m = held()
  // The first person pays for the seed — the meta space and the platform app,
  // minted on the directory's first write. That happens once ever and is not
  // what signing in costs.
  let first = crypto.randomUUID()
  m.put(first, { person: {}, email: { address: 'first@yaks.app' } })
  await m.dir.own(first)

  // What a later person's first sign-in costs: where they sit, who they are
  // (a seat from before `member.own` is marked at the space their address
  // names), the write that mints their space, which reads whether its address
  // is free and still redirects for a space that left it (D-131924) where it
  // writes (facets/directory-graph.ts), and their seat read back afterwards.
  let them = crypto.randomUUID()
  m.put(them, { person: {}, email: { address: 'dana@yaks.app' } })
  m.hops.length = 0
  let mine = await m.dir.own(them)
  assertEquals(mine.slug, 'dana')
  assertEquals(m.hops.length, 4, m.hops.join('\n'))

  // And what it costs once they have one: the ordinary sign-in, which is
  // every sign-in after the first: where they sit, and those spaces, in one
  // read however many, the seat marking which is theirs.
  m.hops.length = 0
  assertEquals((await m.dir.own(them)).eid, mine.eid)
  assertEquals(m.hops.length, 1, m.hops.join('\n'))
})

test('directory clients read their own stores at the current revision', async () => {
  let a = stub()
  let b = stub()
  assertEquals((await a.dir.space('jeff'))?.slug, 'jeff')
  assertEquals((await b.dir.space('jeff'))?.slug, 'jeff')
  assertEquals((await a.dir.space('jeff'))?.slug, 'jeff')
  assertEquals(a.at.reads, 2)
  assertEquals(b.at.reads, 1)
})

test('directory callers decode independent rows and retry a bad read at a fresh revision', async () => {
  let revision = 7, reads = 0
  let dir = directory({
    fetch: (request) => {
      if (request.method == 'POST') {
        revision++
        return Promise.resolve(Response.json([]))
      }
      reads++
      return Promise.resolve(
        new Response(
          reads == 1
            ? 'not json'
            : JSON.stringify(['first', 'second'].map((eid) => ({
              entity: { eid },
              switched: { app: an.eid, to: 'v1' },
            }))),
          { headers: { [EPOCH]: String(revision) } },
        ),
      )
    },
  })
  await tallying(new Map(), async () => {
    await assertRejects(() => dir.switches(an), SyntaxError)
    let first = await dir.switches(an)
    first[0].entity.eid = 'changed'
    first[0].switched!.to = 'changed'
    first[0].policy.revision = -1
    assertEquals(first[1].policy.revision, 7)
    let again = await dir.switches(an)
    assertEquals([
      again[0].entity.eid,
      again[0].switched!.to,
      again[0].policy.revision,
    ], ['first', 'v1', 7])
    assertEquals(reads, 2)
    await dir.apply({ entities: [] })
    assertEquals((await dir.switches(an))[0].policy.revision, 8)
    assertEquals(reads, 3)
  })
})

test('an app row that says no access mode is read as private', () => {
  let row = {
    entity: { eid: an.eid },
    app: { slug: 'lost', space: space.eid, version: 1 },
  }
  assertEquals(dirPart.appAbout(row).access, 'private')
  let open = { ...row, app: { ...row.app, access: 'open' as const } }
  assertEquals(dirPart.appAbout(open).access, 'open')
})

test('pointer history lowers expanded actor and session references', async () => {
  let dir = directory({
    fetch: () =>
      Promise.resolve(rows([{
        entity: { eid: 'move' },
        switched: {
          app: 'a1',
          from: 'v1',
          to: 'v2',
          by: { eid: 'person' },
          via: { eid: 'session' },
        },
      }])),
  })
  let [row] = await dir.switches(an)
  assertEquals(row.switched?.by, 'person')
  assertEquals(row.switched?.via, 'session')
})

test('the directory part shares its cache, refreshes and clears it after a write', async () => {
  let version = 1, reads = 0
  let headers: Record<string, string> | undefined
  let store: Meta = {
    query: (q) => {
      if (q == 'app') reads++
      return Promise.resolve([{ entity: { eid: 'row' }, app: { version } }])
    },
    apply: (_rows, sent) => {
      headers = sent
      version = 3
      return Promise.resolve([])
    },
  }
  let first = dirPart.part(store), second = dirPart.part(store)
  let before = await first.query('app')
  version = 2
  assertEquals(await second.query('app'), before)
  assertEquals(reads, 1)
  assertEquals(JSON.parse(await second.query('app', true))[0].app.version, 2)
  await first.apply([], {
    'x-yak-person': 'person',
    'x-yak-actor': 'writer',
    'x-yak-via': 'session',
    extra: 'private',
  })
  assertEquals(headers, {
    'x-yak-person': 'person',
    'x-yak-actor': 'writer',
    'x-yak-via': 'session',
  })
  assertEquals(JSON.parse(await second.query('app'))[0].app.version, 3)
  assertEquals(reads, 3)
})

test('the directory HTTP door carries only admitted write headers to its part', async () => {
  let headers: Record<string, string> | undefined
  let store: Meta = {
    query: () => Promise.resolve([{ entity: { eid: 'seed' } }]),
    apply: (rows, sent) => {
      headers = sent
      return Promise.resolve(rows)
    },
  }
  let rows = [{ entity: { eid: 'written' }, doc: { title: 'A title' } }]
  let result = await dirPart.over(store)(
    new Request('http://directory/apply', {
      method: 'POST',
      body: JSON.stringify({ entities: rows }),
      headers: {
        'x-yak-person': 'person',
        'x-yak-actor': 'writer',
        'x-yak-via': 'session',
        'x-yak-kernel': '1',
        cookie: 'private',
      },
    }),
  )
  assertEquals(await result.json(), rows)
  assertEquals(headers, {
    'x-yak-person': 'person',
    'x-yak-actor': 'writer',
    'x-yak-via': 'session',
    'x-yak-kernel': '1',
  })
})

test("the directory door answers a refusal in the store's terms and throws a fault on", async () => {
  let seeded = () => Promise.resolve([{ entity: { eid: 'seed' } }])
  let door = (query: Meta['query'], apply: Meta['apply'] = seeded) =>
    directory(fixture({ query, apply }))
  let thrown = (p: Promise<unknown>) => p.then(() => null, (e) => e)
  let no = await answered(
    Response.json({ error: 'Unknown', message: 'no word' }, { status: 400 }),
  )
  let said = await thrown(door(() => Promise.reject(no)).space('jeff'))
  assertEquals([said.name, said.message, said.status], [
    'Unknown',
    'no word',
    400,
  ])
  let write = (e: Error) =>
    thrown(door(seeded, () => Promise.reject(e)).apply({ entities: [] }))
  assert(await write(new Stale('e1', 'doc', 'title', 'now')) instanceof Stale)
  assert(await write(new Pending('kept')) instanceof Pending)
  let broke = new TypeError('store fell over')
  assertEquals(
    await thrown(door(() => Promise.reject(broke)).space('jeff')),
    broke,
  )
})

let offersGraph = graph({ storage: ram(routingVocab), vocab: routingVocab })
await offersGraph.apply([
  {
    entity: { eid: 'offers-space' },
    space: { slug: 'offers', store: 'offers' },
    doc: { title: 'Offers' },
    plan: { tier: 'plus' },
  },
  {
    entity: { eid: 'offers-trash' },
    space: { slug: 'trash', store: 'trash' },
    trashed: { at: '2026-10-31' },
  },
  ...[
    ['offer-old', 'offers-space', '2026-10-29', false],
    ['offer-new', 'offers-space', '2026-10-31', false],
    ['offer-trashed', 'offers-space', '2026-10-30', true],
    ['offer-space-trashed', 'offers-trash', '2026-10-30', false],
  ].map(([eid, space, at, trashed]) => ({
    entity: { eid: String(eid) },
    app: {
      space: String(space),
      slug: String(eid),
      access: 'public',
      version: 1,
    },
    published: { name: String(eid), version: 1, at: String(at) },
    ...trashed ? { trashed: { at: String(at) } } : {},
  })),
], { trusted: true })

test('offers reads its apps and spaces together and screens both trash marks', async () => {
  let reads = 0
  let dir = directory(fixture({
    query: async (q) => {
      reads++
      return await offersGraph.read(q) as dirPart.Row[]
    },
    apply: () => Promise.resolve([]),
  }))
  let found = await dir.offers()
  assertEquals(
    found.map((
      { app, space },
    ) => [app.eid, space.slug, space.title, space.tier]),
    [
      ['offer-new', 'offers', 'Offers', 'plus'],
      ['offer-old', 'offers', 'Offers', 'plus'],
    ],
  )
  assertEquals(reads, 1)
})

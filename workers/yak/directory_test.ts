// Directory reads through its cache and the serving app roster that must be
// fresh and coherent across apps in one request.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { Stale } from '@yaks/graph/errors'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { platformVocab } from './vocab.ts'
import * as dirPart from './directory.ts'
import { type App, directory, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { READS } from './directory-copy.ts'
import { tallying } from './lib/hops.ts'
import { answered, type Meta, meta, metaOf } from './meta.ts'
import { doorOf, PLATFORM_STORE, STATIC_QUERY } from './door.ts'
import { EPOCH } from './directory-copy.ts'
import { Pending } from './writes.ts'

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
  assertEquals(await directory(via, true).all(), [])
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
  tier: null,
  plan: null,
  stripe: null,
  fee: 0,
  meter: null,
  told: false,
  trashed: null,
  slugs: [],
  tunnel: null,
}

let an: App = {
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

test('a release is served only after its deploy records it', async () => {
  let source = 'jeff.1f7c3e/.releases/a1/'
  let dir = directory({
    fetch: (req: Request) => {
      let q = new URL(req.url).searchParams.get('q') ?? ''
      let found = q.endsWith(`.deploy.source=${source}live`)
      return Promise.resolve(Response.json(
        found
          ? [{
            entity: { eid: 'd1' },
            deploy: { app: 'a1', source, version: 1 },
          }]
          : [],
      ))
    },
  })
  assertEquals(await dir.released(an, `${source}live`), true)
  assertEquals(await dir.released(an, `${source}failed`), false)
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
              return Response.json([{
                entity: { eid: 's1', num: 1 },
                space: { slug: 'jeff', store: 'jeff' },
              }])
            }
            return Response.json([
              {
                entity: { eid: 'm1', num: 1 },
                space: { slug: 'yak', store: 'yak' },
              },
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
    dir: directory(dirPart.part(meta(env))),
  }
}

// A hostname someone else owns, resolved to the place it serves (T-33037,
// T-34596) — the read index.ts makes before it falls back to the apex. One
// aimed at an app answers that app and the space it is in; one aimed at the
// space answers the space with no app, which is how `aimed` knows to leave the
// path alone. A hostname nobody attached answers null, which is what keeps
// every address that exists today routing as it always has.
let hosts = () =>
  directory(dirPart.part({
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
    let via = dirPart.part(store)
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
let routingDir = directory(dirPart.part({
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

// A comp is the platform holding one of its own spaces to no ceiling. It is a
// constant read here and a property nowhere: what makes that safe is that
// nothing on the wire can reach it, which is the same reason `plan` is
// stamped (billing.ts).
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
  // A filter is ANDed terms; a `?` term only asks for a component to ride
  // along, so it screens nothing.
  let answer = (search: string) => {
    // The graph's own read door: the whole filter line as one parameter.
    let line = new URLSearchParams(search).get('q') ?? ''
    let terms = line.split('&').filter((t) => t && !t.startsWith('?'))
    return rows.filter((row) =>
      terms.every((t) => {
        let [key, want] = t.split('=')
        if (key == '.entity.eid') {
          return want.split(',').includes(row.entity.eid)
        }
        if (key == '.limit' || key == '.after') return true
        let [, name, prop] = key.split('.')
        let comp = row[name] as Record<string, unknown> | undefined
        return prop ? comp?.[prop] == want : !!comp
      })
    )
  }
  let apply = (body: string) => {
    let entities = JSON.parse(body) as Record<string, unknown>[]
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
                epoch: null,
                body: JSON.stringify(answer(`?q=${encodeURIComponent(q)}`)),
              })),
            )
          }
          return Response.json(answer(url.search))
        },
      }),
    },
  } as unknown as Env
  return {
    put,
    hops,
    dir: directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true),
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

  // What a later person's first sign-in costs: who they are and where they sit,
  // in one trip; who they are again for the address their slug is derived from
  // (the request's memory answers it on the deploy), whether that slug is free,
  // whether it still redirects for a space that left it (which the mint takes
  // from that space, D-131924: one read over the handful of spaces that ever
  // moved), the write, and the space read back afterwards.
  let them = crypto.randomUUID()
  m.put(them, { person: {}, email: { address: 'dana@yaks.app' } })
  m.hops.length = 0
  let mine = await m.dir.own(them)
  assertEquals(mine.slug, 'dana')
  assertEquals(m.hops.length, 6, m.hops.join('\n'))

  // And what it costs once they have one: the ordinary sign-in, which is
  // every sign-in after the first: who they are and where they sit, then those
  // spaces, in one read however many, and who they are again as above.
  m.hops.length = 0
  assertEquals((await m.dir.own(them)).eid, mine.eid)
  assertEquals(m.hops.length, 3, m.hops.join('\n'))
})

test('directory caches belong to a store, not the shared isolate', async () => {
  let a = stub()
  let b = stub()
  assertEquals((await a.dir.space('jeff'))?.slug, 'jeff')
  assertEquals((await b.dir.space('jeff'))?.slug, 'jeff')
  assertEquals((await a.dir.space('jeff'))?.slug, 'jeff')
  assertEquals(a.at.reads, 1)
  assertEquals(b.at.reads, 1)
})

test('an app row that says no access mode is read as private', () => {
  let row = {
    entity: { eid: an.eid },
    app: { slug: 'lost', space: space.eid, version: 1 },
  }
  assertEquals(dirPart.appOf(row).access, 'private')
  let open = { ...row, app: { ...row.app, access: 'open' as const } }
  assertEquals(dirPart.appOf(open).access, 'open')
})

test('pointer history lowers expanded actor and session references', async () => {
  let dir = directory({
    fetch: () =>
      Promise.resolve(Response.json([{
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
  await first.apply([], { 'x-yak-person': 'person', extra: 'private' })
  assertEquals(headers, { 'x-yak-person': 'person' })
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
        'x-yak-kernel': '1',
        cookie: 'private',
      },
    }),
  )
  assertEquals(await result.json(), rows)
  assertEquals(headers, { 'x-yak-person': 'person', 'x-yak-kernel': '1' })
})

test("the directory door answers a refusal in the store's terms and throws a fault on", async () => {
  let seeded = () => Promise.resolve([{ entity: { eid: 'seed' } }])
  let door = (query: Meta['query'], apply: Meta['apply'] = seeded) =>
    directory({
      fetch: dirPart.over({ query, apply }),
    })
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

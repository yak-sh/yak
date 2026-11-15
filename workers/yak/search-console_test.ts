import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import type { D1Like } from '@yaks/d1'
import { registration } from '@yaks/connections'
import { d1 } from '../../packages/d1/testing.ts'
import { platform } from './testing.ts'
import { directoryOf } from './directory.ts'
import { CALLBACK, callback, connecting } from './connections.ts'
import { KERNEL, meta } from './meta.ts'
import { minted } from './session.ts'
import { call, type Ctx } from './tools.ts'
import { propertyOf, statsBody } from './search-console.ts'

// A person connects Google Search Console from their connections page, and an
// agent reads their site's search numbers and submits its sitemap through it.
// Google is faked at the fetch it is called through.
let SECRET = 'search-console'
let { env } = platform(SECRET, {
  VAULT: d1() as unknown as D1Like,
  VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
})
let dir = directoryOf(env.STORE)
let person = crypto.randomUUID(), eid = crypto.randomUUID()
await dir.apply({
  entities: [
    { entity: { eid: person }, person: {}, doc: { title: 'Jeff' } },
    { entity: { eid }, space: { slug: 'jeff', store: 'jeff' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: eid, role: 'owner' },
    },
  ],
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })
await meta(env).apply(
  [registration('google', { id: 'yaks', secret: 's' })],
  KERNEL,
)
let space = (await dir.at(eid))!

let asked: Request[] = []
let real = globalThis.fetch
let id_token = `e30.${
  btoa(JSON.stringify({ email: 'jeff@example.com' })).replace(/=+$/, '')
}.sig`
let SITEMAP = {
  path: 'https://yaks.app/sitemap.xml',
  lastSubmitted: '2026-11-15T20:00:00Z',
  isPending: true,
  errors: '0',
  warnings: '0',
}
globalThis.fetch = (input, init) => {
  let r = new Request(input, init)
  let url = new URL(r.url)
  if (!url.host.endsWith('googleapis.com')) return real(r)
  asked.push(r.clone())
  let json = (v: unknown) => Promise.resolve(Response.json(v))
  if (url.host == 'oauth2.googleapis.com') {
    return json({ access_token: 'A1', refresh_token: 'R1', id_token })
  }
  if (url.pathname.endsWith('/searchAnalytics/query')) {
    return json({
      rows: [{
        keys: ['https://yaks.app/'],
        clicks: 3,
        impressions: 120,
        ctr: 0.025,
        position: 8.4,
      }],
    })
  }
  if (r.method == 'PUT') return Promise.resolve(new Response(null))
  if (url.pathname.endsWith('/sitemaps')) return json({ sitemap: [SITEMAP] })
  if (url.pathname.includes('/sitemaps/')) return json(SITEMAP)
  return json({
    siteEntry: [{
      siteUrl: 'sc-domain:yaks.app',
      permissionLevel: 'siteOwner',
    }],
  })
}

let ctx: Ctx = { env, dir, person }
let tool = async (name: string, args: Record<string, unknown>) =>
  (await call(ctx, name, { space: 'jeff', ...args })).text

// Connected from the connections page: Connect, then back from Google.
let connect = async () => {
  let form = new FormData()
  form.set('do', 'add')
  form.set('integration', 'google-search-console')
  let went = await connecting(
    new Request(
      'https://yaks.app/manage/jeff/connections?enable=google-search-console',
    ),
    env,
    space,
    { person, role: 'owner' },
    form,
  ) as Response
  let location = new URL(went.headers.get('location')!)
  let attempt = went.headers.get('set-cookie')!.split(';')[0]
  let session =
    (await minted(new Request('https://yaks.app/'), env, SECRET, person))
      .split(';')[0]
  await callback({
    env,
    req: new Request(
      `https://yaks.app${CALLBACK}?code=C&state=${
        location.searchParams.get('state')
      }`,
      { headers: { cookie: `${attempt}; ${session}` } },
    ),
    path: CALLBACK,
    space: null,
  })
  return location
}

test('before it is connected, the answer gives the link that connects it', async () => {
  let refused = await assertRejects(() => tool('search_stats', {}))
  assertStringIncludes(
    String((refused as Error).message),
    'https://yaks.app/manage/jeff/connections?enable=google-search-console#google-search-console',
  )
})

test('connecting signs in with Google, asking for webmasters', async () => {
  let at = await connect()
  assertEquals(at.host, 'accounts.google.com')
  assertStringIncludes(
    at.searchParams.get('scope')!,
    'https://www.googleapis.com/auth/webmasters',
  )
})

test('connected, it reads the properties, each page, and the sitemaps', async () => {
  assertEquals(
    await tool('search_stats', {}),
    'sc-domain:yaks.app (siteOwner)',
  )
  assertStringIncludes(
    await tool('search_stats', { site: 'yaks.app', page: 'yaks.app/' }),
    'https://yaks.app/ — 3 clicks, 120 impressions, 2.5% click-through, position 8.4',
  )
  let query = asked.find((r) => r.url.endsWith('/searchAnalytics/query'))!
  assertEquals(
    query.url,
    'https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Ayaks.app/searchAnalytics/query',
  )
  assertEquals(query.headers.get('authorization'), 'Bearer A1')
  assertStringIncludes(
    await tool('search_sitemap', {
      site: 'yaks.app',
      sitemap: 'https://yaks.app/sitemap.xml',
    }),
    'Submitted. https://yaks.app/sitemap.xml, submitted 2026-11-15T20:00:00Z, waiting for Google to read it',
  )
  assertEquals(asked.filter((r) => r.method == 'PUT').map((r) => r.url), [
    'https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Ayaks.app/sitemaps/https%3A%2F%2Fyaks.app%2Fsitemap.xml',
  ])
})

test('a property and the query Google is asked', () => {
  for (
    let [site, property] of [
      ['yaks.app', 'sc-domain:yaks.app'],
      ['sc-domain:yak.sh', 'sc-domain:yak.sh'],
      ['https://yak.sh/', 'https://yak.sh/'],
    ]
  ) assertEquals(propertyOf(site), property)
  assertEquals(
    statsBody(
      { dims: ['page', 'query'], days: 7, query: 'web apps' },
      10,
      new Date('2026-11-15T12:00:00Z'),
    ),
    {
      startDate: '2026-11-08',
      endDate: '2026-11-15',
      dimensions: ['page', 'query'],
      rowLimit: 10,
      dimensionFilterGroups: [{
        filters: [{
          dimension: 'query',
          operator: 'contains',
          expression: 'web apps',
        }],
      }],
    },
  )
})

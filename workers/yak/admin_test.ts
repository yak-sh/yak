// The platform admin's directory (admin.ts): what each row uses, counted over
// the whole directory, and the door that draws it for the admin alone.
import { ownedBy } from './directory-fixture.ts'
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { answer, type Census, uses } from './admin.ts'
import {
  type Directory,
  directory,
  fetch as directoryFetch,
  META,
  type Meter,
  type Row,
  type Space,
} from './directory.ts'
import { analytics, platform } from './testing.ts'
import type { Env } from './env.ts'
import { COOKIE, sign } from './lib/token.ts'
import { drawn } from './render/mod.ts'
import { referralEid } from './referral.ts'

let ROOT = { eid: 'meta', slug: META.space } as Space
let SECRET = 'secret'
let EMPTY: Census = {
  people: [],
  spaces: [],
  apps: [],
  seats: [],
  deploys: [],
  referrals: [],
  agents: [],
}
// Sessions as the sign-in mints them, made once.
let SIGNED_IN = Object.fromEntries(
  await Promise.all(['ann', 'root'].map(async (person) => [
    person,
    `${COOKIE}=${await sign({ person, space: null, exp: 4e9 }, SECRET)}`,
  ])),
)
let NOW = new Date('2026-10-14T12:00:00Z')
let meter = (m: Partial<Meter>) => ({ month: '2026-10', ...m })
let census = (): Census => ({
  people: [
    { entity: { eid: 'ann' }, person: {}, email: { address: 'ann@x.com' } },
    {
      entity: { eid: 'bot' },
      person: {},
      email: { address: 'probe@bot.yak.sh' },
      used: { at: '2026-10-13T00:00:00Z' },
      signed_in: { at: '2026-10-14T09:00:00Z' },
    },
  ],
  spaces: [
    {
      entity: { eid: 'home' },
      space: { slug: 'ann', store: 'ann' },
      meter: meter({ models: 0.25, realtime: 0.25, files: 20 }),
    },
    {
      entity: { eid: 'shop' },
      space: { slug: 'shop', store: 'shop' },
      plan: { tier: 'plus' },
      meter: meter({ models: 1, files: 3 }),
    },
    { entity: { eid: 'lab' }, space: { slug: 'lab', store: 'lab' } },
  ],
  // Each wears its access mode, as every stored app does: a row without one
  // is reported as a failure (directory.ts `unsaid`).
  apps: [
    {
      entity: { eid: 'a1' },
      app: { slug: 'notes', space: 'home', version: 2, access: 'private' },
      meter: meter({ requests: 40, bytes: 100, visits: 7 }),
      used: { at: '2026-10-12T00:00:00Z' },
      changed: { at: '2026-10-11T00:00:00Z' },
      errored: { at: '2026-10-10T00:00:00Z' },
    },
    {
      entity: { eid: 'a2' },
      app: { slug: 'cart', space: 'shop', version: 1, access: 'public' },
      meter: { month: '2026-09', requests: 9, bytes: 990 },
      used: { at: '2026-10-14T10:00:00Z' },
    },
    {
      entity: { eid: 'a3' },
      app: { slug: 'old', space: 'shop', version: 1, access: 'private' },
      meter: { bytes: 7, files: 3 },
      trashed: { at: '2026-10-01T00:00:00Z' },
    },
    {
      entity: { eid: 'a4' },
      app: { slug: 'try', space: 'lab', version: 1, access: 'open' },
    },
  ],
  seats: [
    {
      entity: { eid: 's1' },
      member: { space: 'home', person: 'ann', role: 'owner' },
    },
    {
      entity: { eid: 's2' },
      member: { space: 'shop', person: 'ann', role: 'owner' },
    },
    {
      entity: { eid: 's3' },
      member: { space: 'lab', person: 'bot', role: 'owner' },
    },
    {
      entity: { eid: 's4' },
      member: { space: 'shop', person: 'bot', role: 'viewer' },
    },
  ],
  deploys: [
    {
      entity: { eid: 'd1' },
      deploy: { app: 'a1' },
      created: { at: '2026-10-02T00:00:00Z' },
    },
    {
      entity: { eid: 'd2' },
      deploy: { app: 'a1' },
      created: { at: '2026-10-09T00:00:00Z' },
    },
  ],
} as Census)

test('a person totals what the spaces they own spent, with no budget of their own', () => {
  let u = uses(census(), NOW)
  assertEquals(u.get('ann'), {
    spend: { spent: 1.5 },
    storage: 1120,
    apps: 2,
    active: '2026-10-14T10:00:00Z',
    test: false,
  })
  assertEquals(u.get('bot')?.active, '2026-10-14T09:00:00Z')
  assertEquals(u.get('bot')?.test, true)
})

test('a space counts its live apps and its latest use; an app its month', () => {
  let u = uses(census(), NOW)
  assertEquals(u.get('shop'), {
    spend: { spent: 1 },
    storage: 1000,
    apps: 1,
    active: '2026-10-14T10:00:00Z',
    test: false,
  })
  assertEquals(u.get('a1')?.requests, 40)
  assertEquals(u.get('a2')?.requests, 0, 'last month is not this month')
  // What a space holds is its apps' data and its files, an app in the trash
  // included, and holding is no month's figure.
  assertEquals(
    ['a1', 'a2', 'a3'].map((a) => u.get(a)?.storage),
    [100, 990, 10],
  )
  assertEquals([u.get('lab')?.test, u.get('a4')?.test], [true, true])
})

test('an app says when it was deployed, changed and broke, and who owns it', () => {
  let u = uses(census(), NOW)
  let a1 = u.get('a1')!
  assertEquals(
    [a1.deployed, a1.changed, a1.errored, a1.visits, a1.owners],
    [
      { at: '2026-10-09T00:00:00Z', by: null },
      '2026-10-11T00:00:00Z',
      '2026-10-10T00:00:00Z',
      7,
      ['ann'],
    ],
  )
  let a2 = u.get('a2')!
  assertEquals(
    [a2.deployed, a2.changed, a2.errored, a2.visits],
    [null, null, null, null],
  )
  let c = census()
  let row = drawn(c.apps[0], 'Directory.List.Tile', { uses: a1, space: 'ann' })
  for (
    let said of [
      'ann/notes · ann',
      'Deployed',
      '9 Oct',
      'Data changed',
      '11 Oct',
      'Last error',
      '10 Oct',
      'Requests this month',
      'Visits, 30 days',
    ]
  ) assertStringIncludes(row, said)
  assertStringIncludes(
    drawn(c.apps[1], 'Directory.List.Tile', { uses: a2, space: 'shop' }),
    'not counted yet',
  )
})

test("an app's row says whether it is published and in the gallery", () => {
  let marks = (parts: Record<string, unknown>) => {
    let row = drawn({ ...census().apps[0], ...parts }, 'Directory.List.Tile', {
      space: 'ann',
    })
    return ['not published', '>published', 'in the gallery'].filter((said) =>
      row.includes(said)
    )
  }
  let published = { name: 'notes', version: 2 }
  let listed = { asked_at: NOW, listed_at: NOW }
  assertEquals(marks({}), ['not published'])
  assertEquals(marks({ published }), ['>published'])
  assertEquals(marks({ published, gallery: { asked_at: NOW } }), ['>published'])
  assertEquals(marks({ published, gallery: listed }), [
    '>published',
    'in the gallery',
  ])
  assertEquals(marks({ gallery: listed }), ['not published'])
})

let env = { SESSION_SECRET: SECRET } as Env
let dir = {
  space: (slug: string) => Promise.resolve(slug == META.space ? ROOT : null),
  role: (_: Space, person: string) =>
    Promise.resolve(person == 'root' ? 'owner' : null),
  census: () =>
    Promise.resolve({ ...EMPTY, people: census().people.slice(0, 1) }),
} as unknown as Directory
// The directory's words, and its renderers' queries compiled against them,
// are made once an isolate, by the first page to draw a row: made here, so
// a case times its own page.
drawn(census().people[0], 'Directory.List.Tile')
// What the router hands the admin's door for `path`, signed in as `person`.
let asking = (path: string, person?: string) =>
  [
    new Request(`https://yaks.app${path}`, {
      headers: person ? { cookie: SIGNED_IN[person] } : {},
    }),
    env,
    path.split('?')[0],
    dir,
  ] as const
test('the census reads which app each release is of and when, never its files, and who invited whom', async () => {
  await using p = platform('census deploys')
  let dir = directory({ fetch: (r) => directoryFetch(r, p.env) })
  let space = await ownedBy(dir, 'census-owner', 'census-deploys')
  let invitee = crypto.randomUUID()
  await dir.stamp({
    entities: [{ entity: { eid: invitee }, person: {} }, {
      entity: { eid: referralEid(invitee) },
      referral: { inviter: 'census-owner', invitee },
    }],
  })
  await dir.apply({
    entities: [
      {
        entity: { eid: 'census-app' },
        app: {
          slug: 'probe',
          space: space.eid,
          store: 'census-deploys/probe',
          access: 'private',
        },
      },
      {
        entity: { eid: 'census-release' },
        deploy: { app: 'census-app', version: 1, files: '{"a.js":"sha"}' },
      },
    ],
  })
  let { deploys, people, referrals } = await dir.census()
  let [row] = deploys
  assertEquals([deploys.length, row.deploy], [1, { app: 'census-app' }])
  assertEquals(typeof row.created?.at, 'string')
  // The owner was given the starter with their first space, and invited one.
  let owner = people.find((r) => r.entity.eid == 'census-owner')
  assertEquals(owner?.started, { space: space.eid })
  assertEquals(
    referrals.map((r) => [r.referral, typeof r.created?.at]),
    [[{ inviter: 'census-owner', invitee }, 'string']],
  )
})

test("a row's figures carry their days, and a person's are their spaces' added", () => {
  let c: Census = {
    ...EMPTY,
    people: [{
      entity: { eid: 'ann' },
      person: {},
      email: { address: 'ann@x.com' },
    }],
    spaces: [
      {
        entity: { eid: 's' },
        space: { slug: 'ann' },
        trend: { spend: { '2026-10-14': 0.5 }, requests: { '2026-10-13': 7 } },
      },
      {
        entity: { eid: 't' },
        space: { slug: 'two' },
        trend: { spend: { '2026-10-14': 0.25 } },
      },
    ],
    apps: [{
      entity: { eid: 'a' },
      app: { slug: 'one', space: 's' },
      trend: { requests: { '2026-10-14': 3 } },
    }],
    seats: ['s', 't'].map((space) => ({
      entity: { eid: `seat-${space}` },
      member: { person: 'ann', space, role: 'owner' },
    })),
  } as unknown as Census
  let all = uses(c, NOW)
  assertEquals(all.get('ann')?.spending?.values.at(-1), 0.75)
  assertEquals(all.get('s')?.requesting?.values.at(-2), 7)
  let row = drawn(c.apps[0], 'Directory.List.Tile', {
    uses: all.get('a'),
    base: '/admin',
  })
  assertStringIncludes(row, 'data-chart="line"')
  assertStringIncludes(row, 'data-noun="request"')
  // A quiet row draws its number alone.
  let quiet = drawn(c.apps[0], 'Directory.List.Tile', {
    uses: { requests: 0 },
    base: '/admin',
  })
  assertEquals(quiet.includes('data-chart'), false)
})

test("the admin's funnel shows each step's count", async () => {
  let sql = analytics((q) =>
    q.includes('GROUP BY step') ? [{ step: 'home', n: 12 }] : []
  )
  try {
    let on = { ...env, CF_ANALYTICS_TOKEN: 't', CF_ACCOUNT: 'a' } as Env
    let [req, , path] = asking('/admin/funnel?days=30', 'root')
    let page = (await answer(req, on, path, dir))!
    assertEquals(page.status, 200)
    let html = await page.text()
    assertStringIncludes(html, '<dt>Home page visits</dt><dd>12</dd>')
    // Thirty days back, in the seconds the SQL API's toDateTime takes.
    let at = Number(/toDateTime\((\d+)\)/.exec(sql.asked[0])![1]) * 1000
    assertEquals(Math.round((Date.now() - at) / 86_400_000), 30)
  } finally {
    sql.done()
  }
})

// Jeff invited Ana, who built and gave his space a month, Bo, who signed up
// by text and hasn't built, and a probe account. Dee pays through Stripe, so
// Eve's first app moved her charge. Jeff and Bo were each given the starter.
let on = (day: string) => `2026-10-${day}T12:00:00.000Z`
let someone = (eid: string, name: string, more: Partial<Row> = {}): Row => ({
  entity: { eid },
  person: {},
  doc: { title: name },
  email: { address: `${eid}@x.com` },
  ...more,
})
let invite = (
  inviter: string,
  invitee: string,
  day: string,
  rewarded?: NonNullable<Row['rewarded']>,
): Row => ({
  entity: { eid: `${inviter}-${invitee}` },
  referral: { inviter, invitee },
  created: { at: on(day) },
  ...rewarded ? { rewarded } : {},
})
let made = (eid: string, slug: string, day?: string): Row => ({
  entity: { eid },
  space: { slug },
  ...day ? { created: { at: on(day) } } : {},
})
let inviting = {
  ...EMPTY,
  people: [
    someone('jeff', 'Jeff', { started: { space: 'jhome' } }),
    someone('ana', 'Ana'),
    someone('bo', 'Bo', {
      email: undefined,
      phone: { number: '+12695550177' },
      started: { space: 'bhome' },
    }),
    someone('probe', 'Probe', { email: { address: 'probe@bot.yak.sh' } }),
    someone('dee', 'Dee'),
    someone('eve', 'Eve'),
  ],
  spaces: [made('jhome', 'jeff', '01'), made('bhome', 'bo', '03'), {
    ...made('dhome', 'dee'),
    plan: { tier: 'plus' },
  }],
  referrals: [
    invite('jeff', 'ana', '02', {
      at: on('05'),
      space: 'jhome',
      until: '2026-11-05T12:00:00.000Z',
    }),
    invite('jeff', 'bo', '03'),
    invite('jeff', 'probe', '04'),
    invite('dee', 'eve', '06', {
      at: on('07'),
      space: 'dhome',
      until: '2026-12-01T12:00:00.000Z',
      subscription: 'sub_dee',
    }),
  ],
} as Census
let admin = { ...dir, census: () => Promise.resolve(inviting) } as Directory
// A page as the admin reads it: which side link is current, and each row
// under a heading, where it opens, its name, the line under it, its tags and
// its figures.
let page = async (path: string) => {
  let [req, , at] = asking(path, 'root')
  let { document } = parseHTML(
    await (await answer(req, env, at, admin))!.text(),
  )
  let tiles = (heading: string) => {
    let group = [...document.querySelectorAll('h2.Group')]
      .find((h) => h.textContent == heading)
    return [
      ...group?.nextElementSibling?.querySelectorAll('.Directory_Row') ?? [],
    ].map((row) => [
      row.querySelector('.Directory_Open')?.getAttribute('href'),
      row.querySelector('strong')?.textContent,
      row.querySelector('.Directory_Sub')?.textContent,
      ...[...row.querySelectorAll('.Chips > *, .Directory_Uses dd')]
        .map((t) => t.textContent),
    ])
  }
  return {
    current: document.querySelector('[aria-current="page"]')?.textContent,
    // On a phone, the top bar's Menu and the side it opens.
    menu: [
      document.querySelector('.Desk_Bar a')?.getAttribute('href'),
      document.querySelector('#menu')?.getAttribute('aria-label'),
      document.querySelector('#menu .Desk_Close')?.getAttribute('href'),
    ],
    signedUp: tiles('Signed up through an invite'),
    starters: tiles('Given the starter'),
    invited: tiles('Invited'),
  }
}
let invites = await page('/admin/invites')
let jeffs = await page('/admin/jeff')

test('on a phone, Menu opens the admin side as it opens the dashboard side', () => {
  assertEquals(invites.menu, ['#menu', 'Directory', '#'])
})

test("the admin's Invites page says who invited whom, when, and the month each first app gave", () => {
  assertEquals(invites.current, 'Invites3')
  assertEquals(invites.signedUp, [
    [
      '/admin/eve',
      'Eve',
      'invited by Dee',
      'charge moved',
      '6 Oct 2026',
      '7 Oct 2026',
      'dee',
      '1 Dec 2026',
    ],
    ['/admin/bo', 'Bo', 'invited by Jeff', '3 Oct 2026', 'not yet', '', ''],
    [
      '/admin/ana',
      'Ana',
      'invited by Jeff',
      '2 Oct 2026',
      '5 Oct 2026',
      'jeff',
      '5 Nov 2026',
    ],
  ])
})

test("the admin's Invites page says who was given the starter, when and to which space", () => {
  assertEquals(invites.starters, [
    ['/admin/bo', 'Bo', '+12695550177', '3 Oct 2026', 'bo', '$100.00', '$0.00'],
    [
      '/admin/jeff',
      'Jeff',
      'jeff@x.com',
      '1 Oct 2026',
      'jeff',
      '$100.00',
      '$0.00',
    ],
  ])
})

test("an inviter's page lists whom they invited", () => {
  assertEquals(jeffs.invited.map(([, name]) => name), ['Bo', 'Ana'])
})

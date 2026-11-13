// A publisher's page (publisher-page.ts): what a space shares in public, each
// with its reputation, its installs across all of it and its own web address,
// and nothing for a space that shares nothing.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { addresses, answer } from './publisher-page.ts'
import type { App, Directory, Host, SkillOffer, Space } from './directory.ts'
import type { Env } from './env.ts'
import { pageAt, publisherAt } from './gallery-row.ts'
import { skillAt } from './skill-page.ts'
import { app, space } from './testing.ts'
import { parseHTML } from 'linkedom'

let listedAt = '2026-09-06T12:00:00.000Z'
let live = { askedAt: listedAt, listedAt }

let skill = (over: Partial<SkillOffer> = {}): SkillOffer => ({
  eid: 'skill-eid',
  title: 'Pitch copy',
  space: 'space-eid',
  description: 'Write a pitch',
  body: 'Lead with the reader.',
  skill: {},
  upstream: null,
  published: { name: 'pitch-copy', version: 1, at: listedAt, about: '' },
  gallery: { ...live, decision: 'approved', reviewedAt: listedAt },
  ...over,
} as SkillOffer)

let domain = (over: Partial<Host> = {}): Host => ({
  eid: 'host-eid',
  name: 'recipes.example',
  serves: 'space-eid',
  stage: 'active',
  at: listedAt,
  verification: null,
  verified: listedAt,
  to: null,
  ...over,
})

// The directory a page reads, holding these.
let held = (at: {
  spaces?: Space[]
  apps?: App[]
  skills?: SkillOffer[]
  integrations?: { name: string; owner?: string; published?: string }[]
  hosts?: Host[]
}) => {
  let spaces = at.spaces ?? [space()]
  let of = (eid: string) => spaces.find((s) => s.eid == eid)!
  return {
    space: (slug: string) =>
      Promise.resolve(spaces.find((s) => s.slug == slug) ?? null),
    at: (eid: string) => Promise.resolve(of(eid) ?? null),
    offers: () =>
      Promise.resolve(
        (at.apps ?? []).map((a) => ({ space: of(a.space), app: a })),
      ),
    skillOffers: () =>
      Promise.resolve(
        (at.skills ?? []).map((s) => ({ space: of(s.space), skill: s })),
      ),
    integrations: () =>
      Promise.resolve(
        (at.integrations ?? []).map((i) => ({ hosts: [], ...i })),
      ),
    hosts: () => Promise.resolve(at.hosts ?? []),
    uptakes: (made: { of: string }[]) =>
      Promise.resolve(
        new Map(
          made.map((
            { of },
          ) => [of, { installs: 2, rated: { stars: 5, count: 2 } }]),
        ),
      ),
    integrationUptakes: (all: { name: string }[]) =>
      Promise.resolve(
        new Map(
          all.map((
            { name },
          ) => [name, { installs: 1, rated: { stars: 2, count: 1 } }]),
        ),
      ),
  } as unknown as Directory
}

let visit = async (dir: Directory, path = '/spaces/jeff') => {
  let res = await answer(
    new Request(`https://yaks.app${path}`),
    {} as Env,
    path,
    dir,
  )
  return { status: res.status, html: await res.text() }
}

let everything = held({
  spaces: [space({ featured: true })],
  apps: [app({ gallery: live }), app({ eid: 'hidden', slug: 'notes' })],
  skills: [skill()],
  integrations: [
    { name: 'acme', owner: 'space-eid', published: listedAt },
    { name: 'theirs', owner: 'other-eid', published: listedAt },
  ],
  hosts: [
    domain({ name: 'pending.example', stage: 'pending' }),
    domain({ name: 'one-app.example', serves: 'app-eid' }),
    domain(),
  ],
})

test('a publisher page shows what the space shares, with its installs and its own address', async () => {
  let { status, html } = await visit(everything)
  assertEquals(status, 200)
  let { document } = parseHTML(html)
  assertEquals(document.querySelector('h1')!.textContent, 'jeff')
  assertStringIncludes(html, 'jeff shares 1 app, 1 skill, 1 integration')
  // Its own verified domain, not one still pending or aimed at one app.
  assertEquals(
    document.querySelector('.Listing_Head a')!.getAttribute('href'),
    'https://recipes.example/',
  )
  assertStringIncludes(html, 'Featured by yaks.app')
  // Two for the app, two for the skill, one for the integration.
  assertStringIncludes(html, 'Installed 5 times by other spaces')
  // Each thing's rating, and across them all, each weighted by its raters.
  assertStringIncludes(html, 'Rated 5 of 5 by 2 spaces')
  assertStringIncludes(html, 'Rated 4.4 of 5 in 5 ratings')
  assertEquals(
    [...document.querySelectorAll('h3 a')].map((a) => a.getAttribute('href')),
    [
      'https://jeff.yaks.app/recipes/',
      skillAt('pitch-copy'),
      'https://yaks.app/integrations#acme',
    ],
  )
  // Only what is listed: the unlisted app and another's integration are not.
  assert(!html.includes('notes'))
  assert(!html.includes('theirs'))
  assertStringIncludes(
    html,
    `<link rel="canonical" href="${publisherAt('jeff')}">`,
  )
})

test('a space with no domain of its own shows its subdomain', async () => {
  let { document } = parseHTML(
    (await visit(held({ apps: [app({ gallery: live })] }))).html,
  )
  assertEquals(
    document.querySelector('.Listing_Head a')!.getAttribute('href'),
    'https://jeff.yaks.app/',
  )
})

test('a space that shares nothing in public, or none at all, has no page', async () => {
  assertEquals((await visit(held({ apps: [app()] }))).status, 404)
  assertEquals((await visit(everything, '/spaces/nobody')).status, 404)
  assertEquals((await visit(everything, '/spaces/jeff/x')).status, 404)
  let gone = held({
    spaces: [space({ trashed: { at: listedAt } as Space['trashed'] })],
    apps: [app({ gallery: live })],
  })
  assertEquals((await visit(gone)).status, 404)
})

test('the sitemap lists each listed app, skill and publisher', async () => {
  let other = space({ eid: 'other-eid', slug: 'acme' })
  assertEquals(
    await addresses(
      held({
        spaces: [space(), other],
        apps: [app({ gallery: live })],
        skills: [skill()],
        integrations: [{
          name: 'acme',
          owner: 'other-eid',
          published: listedAt,
        }],
      }),
    ),
    [
      pageAt('recipes'),
      skillAt('pitch-copy'),
      publisherAt('jeff'),
      publisherAt('acme'),
    ],
  )
})

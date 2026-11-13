// A skill is shared as an app is (T-161782): published from a space under a
// platform-wide name, reviewed before anyone may install it, installed as a
// copy pinned to the version reviewed, and updated by pulling the next
// reviewed version, which says what changed.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { platform } from './testing.ts'
import { owned } from './directory-fixture.ts'
import { directoryOf, META } from './directory.ts'
import { operatorMemory } from './operator-testing.ts'
import { operatorRequest } from './operator-host.ts'
import { RESULTS, results, skillText } from './operator-skills.ts'
import * as skillPage from './skill-page.ts'
import * as publisherPage from './publisher-page.ts'
import { publisherAt } from './gallery-row.ts'
import { SPACE } from './build-door.ts'
import { replyTo } from '@yaks/platform/host'
import { INTERNAL } from './mail-config.ts'
import type { Letter } from './mail.ts'
import { call, type Ctx } from './tools.ts'

// Each space's Operator store, answered at its routes as the Builder does.
let stores = new Map<string, ReturnType<typeof operatorMemory>>()
let never = (): never => {
  throw new Error('nothing stops here')
}
let storeOf = (space: string) => {
  if (!stores.has(space)) stores.set(space, operatorMemory())
  return stores.get(space)!
}
let { env } = platform('shared-skill', {
  MAIL_DEV: '1',
  BUILDER: {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (request: Request) => {
        let space = request.headers.get(SPACE) ?? String(id)
        let store = storeOf(space)
        if (new URL(request.url).pathname == RESULTS) {
          let { skill } = await request.json()
          return Response.json(await results(store.g, skill, space))
        }
        let answer = await operatorRequest(
          { store, named: () => Promise.resolve(null), stop: () => never() },
          {
            person: request.headers.get('x-yak-person')!,
            role: request.headers.get('x-yak-role') as 'owner',
            space,
            administrative: false,
          },
          new URL(request.url).pathname,
          await request.json(),
          () => undefined,
        )
        return answer ?? new Response('', { status: 404 })
      },
    }),
  },
} as never)

// The letters sent, as `MAIL_DEV` prints them.
let sent: Letter[] = []
let print = console.log
console.log = (...said: unknown[]) => {
  let m = String(said[0]).match(/^yak-mail (\{.*\})$/s)
  m ? sent.push(JSON.parse(m[1])) : print(...said)
}
let letterTo = (to: string) => sent.findLast((l) => [l.to].flat().includes(to))

let dir = directoryOf(env.STORE)
let as = (person: string): Ctx => ({ env, dir, person })
let maker = as(crypto.randomUUID())
let taker = as(crypto.randomUUID())
let kitchen = await owned(maker, 'kitchen')
let shop = await owned(taker, 'shop')
// The platform's admin is an owner of its meta space.
let admin = as(crypto.randomUUID())
await dir.apply({
  entities: [{ entity: { eid: admin.person }, person: {} }, {
    entity: { eid: crypto.randomUUID() },
    member: {
      person: admin.person,
      space: (await dir.space(META.space))!.eid,
      role: 'owner',
    },
  }],
}, { 'x-yak-person': admin.person, 'x-yak-kernel': '1' })

let skillIn = (space: string, title: string, body: string) =>
  storeOf(space).g.apply([{
    entity: { eid: crypto.randomUUID() },
    skill: {},
    doc: { title, body: 'Write a pitch for a product page' },
    content: { body },
  }])
await skillIn(kitchen, 'pitch-copy', 'Lead with what the reader gets.\n')
let run = async (ctx: Ctx, name: string, args: Record<string, unknown>) =>
  (await call(ctx, name, args)).text
let refused = async (
  ctx: Ctx,
  name: string,
  args: Record<string, unknown>,
  says: string,
) =>
  assertStringIncludes(
    (await assertRejects(() => call(ctx, name, args), Error)).message,
    says,
  )
// Both answers to a review: a stranger's skill is read by an agent first.
let reviewed = async (skill = 'pitch-copy') => {
  await run(admin, 'gallery_code_review', {
    skill,
    verdict: 'approve',
    findings: 'Writes copy and reaches nothing outside it.',
  })
  await run(admin, 'gallery_review', { skill, decision: 'approve' })
}
let copy = (title = 'pitch-copy') => skillText(storeOf(shop).g, title)
let page = async (name: string) => {
  let path = `${skillPage.PATH}${name}`
  let answer = await skillPage.answer(
    new Request(`https://yaks.app${path}`),
    env,
    path,
    dir,
  )
  return { status: answer.status, html: await answer.text() }
}

test('a published skill is installable only once yaks.app has reviewed it', async () => {
  assertStringIncludes(
    await run(maker, 'app_publish', {
      space: 'kitchen',
      skill: 'pitch-copy',
      about: 'Pitches that lead with the reader',
    }),
    'published the skill pitch-copy as pitch-copy v1 from kitchen',
  )
  assertStringIncludes(
    letterTo(INTERNAL)!.body,
    'app_published --name pitch-copy',
  )
  await refused(taker, 'app_install', {
    space: 'shop',
    name: 'pitch-copy',
  }, 'awaiting review')
  // Nobody browsing sees it yet; the admin, who reviews it, reads it whole.
  assertEquals(
    (await run(taker, 'app_published', {})).includes('pitch-copy'),
    false,
  )
  assertStringIncludes(
    await run(admin, 'app_published', { name: 'pitch-copy' }),
    '    Lead with what the reader gets.',
  )
  await reviewed()
  let letter = letterTo(replyTo(env))!
  assertStringIncludes(letter.body, 'An agent reviewed it: approve.')
  assertStringIncludes(letter.body, 'Lead with what the reader gets.')
  assertStringIncludes(
    await run(taker, 'app_published', {}),
    '- pitch-copy v1 — skill pitch-copy: Pitches that lead with the reader',
  )
})

test("a listed skill's page shows its text, and what a person picked in the platform's runs of it", async () => {
  assertEquals((await page('nothing-here')).status, 404)
  let before = await page('pitch-copy')
  assertEquals(before.status, 200)
  assertStringIncludes(before.html, 'Lead with what the reader gets.')
  assertStringIncludes(before.html, 'Not measured yet.')

  // A round of the skill the platform ran, a row it did not, and a pick.
  let g = storeOf(kitchen).g
  let [mine] = await g.read('.skill')
  let [round, none, lead, office, plain, led, forged] = Array.from(
    { length: 7 },
    () => crypto.randomUUID(),
  )
  let ran = { $actor: { by: kitchen } }
  let wrote = (eid: string, variant: string, headline: string) => ({
    entity: { eid },
    writing: { round, case: office, variant, output: { headline } },
  })
  await g.apply([
    {
      entity: { eid: round },
      round: { skill: mine.entity.eid, parts: ['headline'] },
      doc: { title: 'Round one' },
      ...ran,
    },
    {
      entity: { eid: none },
      variant: { body: '' },
      doc: { title: 'No skill' },
    },
    {
      entity: { eid: lead },
      variant: { body: 'Lead.', theory: 'the reader first' },
      doc: { title: 'Lead with the reader' },
    },
    {
      entity: { eid: office },
      case: { body: 'A desk for small offices' },
      doc: { title: 'The office' },
    },
    { ...wrote(plain, none, 'A desk.'), ...ran },
    { ...wrote(led, lead, 'Your office, sorted.'), ...ran },
    { ...wrote(forged, lead, 'Forged headline'), $actor: { by: maker.person } },
  ], { trusted: true })
  let tap = (second: string) => ({
    entity: { eid: crypto.randomUUID() },
    preference: { first: plain, second, chose: second },
    $actor: { by: maker.person },
  })
  await g.apply([tap(led), tap(forged)], { trusted: true })
  let after = (await page('pitch-copy')).html
  assertStringIncludes(after, '1 pick by 1 person')
  assertStringIncludes(after, 'Lead with the reader')
  assertStringIncludes(after, ' (won)')
  assertStringIncludes(after, 'Your office, sorted.')
  assertStringIncludes(after, 'A desk for small offices')
  assertEquals(after.includes('Forged headline'), false)
  assertStringIncludes(after, 'offered no tools')
  // A winner is a version once it became the skill's text.
  assertEquals(after.includes('Versions'), false)
  await g.apply([{
    entity: { eid: lead },
    adopted: { skill: mine.entity.eid },
    ...ran,
  }], { trusted: true })
  assertStringIncludes(
    (await page('pitch-copy')).html,
    'Lead with the reader</strong>, which won Round one',
  )

  // Every listed skill's page is in the sitemap, and so is its publisher's.
  assertEquals(await publisherPage.addresses(dir, env), [
    skillPage.skillAt('pitch-copy', env),
    publisherAt('kitchen', env),
  ])
})

test('an installed skill is a copy pinned to the version it took', async () => {
  assertStringIncludes(
    await run(taker, 'app_install', { space: 'shop', name: 'pitch-copy' }),
    'installed the skill pitch-copy (pitch-copy v1) in shop',
  )
  let had = await copy()
  assertEquals(had?.body, 'Lead with what the reader gets.\n')
  assertEquals(had?.installed?.version, 1)
  // Credited to kitchen once, however often shop installs it (T-131912).
  await run(taker, 'app_install', { space: 'shop', name: 'pitch-copy' })
  assertStringIncludes(
    await run(taker, 'app_published', { name: 'pitch-copy' }),
    'Installed by 1 other space',
  )
  await refused(taker, 'app_publish', {
    space: 'shop',
    skill: 'pitch-copy',
  }, 'theirs to offer')
})

test('what yaks.app says of a skill, and its featured mark, shows to a person and to an agent', async () => {
  let reviewedOn = `Reviewed by yaks.app on ${
    new Date().toISOString().slice(0, 10)
  }, version 1`
  let { html } = await page('pitch-copy')
  assertStringIncludes(html, reviewedOn)
  assertStringIncludes(html, 'Installed by 1 other space')
  let listed = () => run(taker, 'app_published', { words: 'pitch-copy' })
  assertStringIncludes(await listed(), reviewedOn)
  // Only the platform admin features, and featuring its space features it.
  await refused(taker, 'gallery_feature', {
    skill: 'pitch-copy',
    featured: true,
  }, 'platform admin')
  await run(admin, 'gallery_feature', { space: 'kitchen', featured: true })
  assertStringIncludes(await listed(), 'Featured by yaks.app')
  assertStringIncludes((await page('pitch-copy')).html, 'Featured by yaks.app')
  await run(admin, 'gallery_feature', { space: 'kitchen', featured: false })
  assertEquals((await listed()).includes('Featured'), false)
  await run(admin, 'gallery_feature', { skill: 'pitch-copy', featured: true })
  assertStringIncludes(await listed(), 'Featured by yaks.app')
  await run(admin, 'gallery_feature', { skill: 'pitch-copy', featured: false })
  assertEquals((await listed()).includes('Featured'), false)
  await refused(admin, 'gallery_feature', {
    integration: 'nothing-here',
    featured: true,
  }, 'not in the integration directory')
  // An integration in the directory says the same signals.
  await run(admin, 'gallery_feature', {
    integration: 'openrouter',
    featured: true,
  })
  let said = await run(taker, 'integration_list', { words: 'openrouter' })
  for (
    let line of [
      'Built by yaks.app',
      'Featured by yaks.app',
      'Installed by 0 other spaces',
    ]
  ) assertStringIncludes(said, line)
})

test('a rating counts the latest from each space that installed it', async () => {
  let rate = (ctx: Ctx, space: string, stars: number) =>
    run(ctx, 'app_rate', { space, name: 'pitch-copy', stars })
  let rated = async () => [
    await run(taker, 'app_published', { name: 'pitch-copy' }),
    (await page('pitch-copy')).html,
  ]
  assertStringIncludes(await rate(taker, 'shop', 3), 'Rated 3 of 5 by 1 space')
  assertStringIncludes(await rate(taker, 'shop', 5), 'Rated 5 of 5 by 1 space')
  // Its maker's, and a space's that never installed it, are kept and not
  // counted.
  assertStringIncludes(await rate(maker, 'kitchen', 1), 'Rated 5 of 5')
  let stranger = as(crypto.randomUUID())
  await owned(stranger, 'cafe')
  assertStringIncludes(
    await rate(stranger, 'cafe', 1),
    'kept, and counted once cafe installs it',
  )
  for (let said of await rated()) {
    assertStringIncludes(said, 'Rated 5 of 5 by 1 space')
  }
  await run(stranger, 'app_install', { space: 'cafe', name: 'pitch-copy' })
  for (let said of await rated()) {
    assertStringIncludes(said, 'Rated 3 of 5 by 2 spaces')
  }
  await refused(taker, 'app_rate', {
    space: 'shop',
    name: 'pitch-copy',
    stars: 6,
  }, 'from 1 to 5')
  // An integration is installed by holding a connection through it.
  assertStringIncludes(
    await run(taker, 'app_rate', {
      space: 'shop',
      integration: 'openrouter',
      stars: 4,
    }),
    'counted once shop installs it',
  )
})

test('a new version waits for review, and an update names what changed', async () => {
  let [mine] = await storeOf(kitchen).g.read('.skill')
  await storeOf(kitchen).g.apply([{
    entity: { eid: mine.entity.eid },
    content: { body: 'Lead with what the reader gets.\nEnd on one ask.\n' },
  }])
  assertStringIncludes(
    await run(maker, 'app_publish', { space: 'kitchen', skill: 'pitch-copy' }),
    'reader\nawaiting review',
  )
  assertStringIncludes(
    await run(taker, 'app_update', { space: 'shop', skill: 'pitch-copy' }),
    'v2 of pitch-copy is awaiting review; pitch-copy stays at v1',
  )
  await reviewed()
  assertEquals(
    await run(taker, 'app_update', { space: 'shop', skill: 'pitch-copy' }),
    'updated pitch-copy from v1 to v2 of pitch-copy:\n+ End on one ask.',
  )
  assertEquals((await copy())?.installed?.version, 2)
  assertStringIncludes(
    await run(taker, 'app_update', { space: 'shop', skill: 'pitch-copy' }),
    'already at v2',
  )
})

test('a published name is one thing on the whole platform', async () => {
  await skillIn(shop, 'pitches', 'Another way.\n')
  await refused(taker, 'app_publish', {
    space: 'shop',
    skill: 'pitches',
    name: 'pitch-copy',
  }, "kitchen's skill pitch-copy")
})

// Someone else's skill, kept in kitchen as it was found (T-161785).
let found = async (title: string, upstream: Record<string, string>) => {
  await skillIn(kitchen, title, `The ${title} way.\n`)
  let [b] = await storeOf(kitchen).g.read(`.skill&.doc.title=${title}`)
  await storeOf(kitchen).g.apply([{ entity: b.entity, upstream }])
}
let at = { source: 'https://github.com/ann/skills', commit: 'abc123' }

test("someone else's skill under a licence that allows copies is hosted with its notice", async () => {
  await found('terse', { ...at, author: 'Ann', licence: 'MIT' })
  await refused(maker, 'app_publish', {
    space: 'kitchen',
    skill: 'terse',
  }, 'set upstream.notice')
  await found('terse', {
    ...at,
    author: 'Ann',
    licence: 'MIT',
    notice: 'Copyright (c) 2026 Ann',
  })
  await run(maker, 'app_publish', { space: 'kitchen', skill: 'terse' })
  await reviewed('terse')
  assertStringIncludes(
    await run(taker, 'app_published', {}),
    'terse v1 — skill terse (from kitchen, written by Ann, from ' +
      'https://github.com/ann/skills at abc123, under MIT, installs as terse',
  )
  await run(taker, 'app_install', { space: 'shop', name: 'terse' })
  assertEquals((await copy('terse'))?.body, 'The terse way.\n')
  assertEquals(
    (await copy('terse'))?.upstream?.notice,
    'Copyright (c) 2026 Ann',
  )
  let { html } = await page('terse')
  assertStringIncludes(html, 'Written by Ann, at ')
  assertStringIncludes(html, 'The terse way.')
  assertStringIncludes(html, 'Copyright (c) 2026 Ann')
})

test("someone else's skill with no licence is listed as a link, holding none of its text", async () => {
  await found('loud', { ...at, author: 'Bo' })
  await found('nameless', { ...at, licence: 'MIT' })
  await refused(maker, 'app_publish', {
    space: 'kitchen',
    skill: 'nameless',
  }, 'set upstream.author')
  assertStringIncludes(
    await run(maker, 'app_publish', { space: 'kitchen', skill: 'loud' }),
    'listed as a link once yaks.app has read it',
  )
  assertStringIncludes(
    await run(admin, 'app_published', { name: 'loud' }),
    'Its instructions are not hosted on yaks.app: with no licence, its ' +
      'author allows no copy. Read them at https://github.com/ann/skills',
  )
  await reviewed('loud')
  let offer = (await dir.skillOffered({ name: 'loud' }))!.skill
  assertEquals(offer.body, '')
  await refused(taker, 'app_install', {
    space: 'shop',
    name: 'loud',
  }, 'listed as a link')
  let { html } = await page('loud')
  assertEquals(html.includes('The loud way.'), false)
  assertStringIncludes(html, 'Read its instructions at its source')
  assertStringIncludes(html, 'lists it as a link')
  assertEquals(html.includes('ask your Operator to install'), false)
})

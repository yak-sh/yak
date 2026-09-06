// Closing a space (T-33166): the pure seams — what the ticket in the letter
// is worth, what the page and the letter say a delete would destroy, and the
// two spaces that may not be deleted at all — then what the act takes with it
// outside the graph over harness.ts's stand-in (T-34371), and then the whole
// act held in workerd: an agent that deletes nothing, a letter that does, and
// a slug back in circulation with none of the last space's bytes or rows
// behind it.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parse } from '@std/toml'
import { r2Blobs } from '../../src/blobs_r2.ts'
import type { Wire } from '@yaks/durable-object'
import { slow, until } from '../../src/testing.ts'
import type { Held } from './build.ts'
import {
  collected,
  DAILY,
  daysLeft,
  type Doomed,
  doomed as census,
  door,
  due,
  erase,
  GRACE,
  letter,
  LIFE,
  naming,
  overdue,
  refused,
  ticket,
  ticketed,
} from './erase.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { App, Host, Space } from './directory.ts'
import type { Env } from './env.ts'
import { ai, platform, sandboxes } from './harness.ts'
import { boxOf, spending } from './sandbox.ts'
import type { Who } from './session.ts'
import { client, connector, kernel, letters, meta, seed } from './probe.ts'

let space = (over: Partial<Space> = {}): Space => ({
  eid: 'space-eid',
  slug: 'shoplab',
  title: 'shoplab',
  tier: 'free',
  plan: null,
  meter: null,
  told: false,
  ...over,
})

let app = (over: Partial<App> = {}): App => ({
  eid: 'app-eid',
  slug: 'shop',
  space: 'space-eid',
  version: 1,
  title: 'The Shop',
  access: 'public',
  store: null,
  slugs: [],
  home: false,
  first: [],
  meter: null,
  published: null,
  installed: null,
  seeded: null,
  trashed: null,
  ...over,
})

let host = (name: string): Host => ({
  eid: `host-${name}`,
  name,
  app: 'app-eid',
  stage: 'active',
  at: '',
})

let doomed = (over: Partial<Doomed> = {}): Doomed => ({
  space: space(),
  apps: [app()],
  hosts: [],
  members: [{ person: 'p1', name: 'Dana' }],
  ...over,
})

Deno.test('a ticket opens one space for one person, for an hour', async () => {
  let secret = 'shhh'
  let t = await ticket(space(), 'p1', secret)
  let open = await ticketed(t, secret)
  assertEquals(open?.space, 'space-eid')
  assertEquals(open?.person, 'p1')
  // Dead an hour on, and dead under any other secret or any edit.
  assertEquals(await ticketed(t, secret, Date.now() + LIFE + 1000), null)
  assertEquals(await ticketed(t, 'another secret'), null)
  assertEquals(await ticketed(`${t}x`, secret), null)
  assertEquals(await ticketed('not a ticket', secret), null)
})

Deno.test('what a delete would destroy is named, not counted', () => {
  let lines = naming(doomed({
    apps: [app(), app({ eid: 'b', slug: 'notes', title: 'Notes' })],
    hosts: [host('herbusiness.com')],
    members: [{ person: 'p1', name: 'Dana' }, { person: 'p2', name: 'Sam' }],
  }))
  let said = lines.join('\n')
  assertStringIncludes(said, 'The Shop (https://shoplab.yaks.app/shop/)')
  assertStringIncludes(said, 'Notes (https://shoplab.yaks.app/notes/)')
  assertStringIncludes(said, 'herbusiness.com stops serving')
  assertStringIncludes(said, '2 people lose their way in: Dana, Sam')
  assertStringIncludes(said, 'shoplab.yaks.app goes back into circulation')
  // One member is the owner reading the letter; there is nobody to warn about.
  assert(!naming(doomed()).some((l) => l.includes('lose their way in')))
  // And the letter says the same words, with the link and the hour.
  let l = letter(doomed(), door('shoplab', 'tkt'))
  assertEquals(l.subject, 'Delete shoplab.yaks.app?')
  assertStringIncludes(l.body, 'https://yaks.app/space/shoplab/delete?t=tkt')
  assertStringIncludes(l.body, 'the next hour')
  assertStringIncludes(l.body, 'The Shop (https://shoplab.yaks.app/shop/)')
})

Deno.test('the platform and a paying space refuse to be deleted', () => {
  assertEquals(refused(space()), '')
  assertStringIncludes(refused(space({ slug: 'yak' })), 'the platform itself')
  let paying = space({
    plan: {
      tier: 'plus',
      customer: 'cus_1',
      subscription: 'sub_1',
      status: 'active',
      until: null,
      ending: null,
      at: '',
    },
  })
  assertStringIncludes(refused(paying), 'Cancel the subscription first')
  // Cancelled at Stripe, the row stays and the space may go.
  assertEquals(
    refused(space({ plan: { ...paying.plan!, status: 'canceled' } })),
    '',
  )
})

// The trash's two numbers (T-34430): how long is left, and whether the sweep
// takes it. A day is a day everywhere — the tool says it, the space page says
// it, `/privacy` says it — so it is counted in one place.
let AT = '2026-09-05T12:00:00.000Z'
let day = 86_400_000
let then = (ms: number) => Date.parse(AT) + ms

Deno.test('the trash is thirty days, counted in whole days left', () => {
  let t = { at: AT, by: 'p1' }
  assertEquals(GRACE, 30 * day)
  assertEquals(daysLeft(t, then(0)), 30)
  // Part of a day left still reads as a day: nobody is told "0 days" about an
  // app they can still have back.
  assertEquals(daysLeft(t, then(29 * day + 1)), 1)
  assertEquals(daysLeft(t, then(30 * day)), 0)
  // And it never goes negative, however long it has sat past its day.
  assertEquals(daysLeft(t, then(90 * day)), 0)
  assertEquals(due(t, then(30 * day - 1)), false)
  assertEquals(due(t, then(30 * day)), true)
  // A mark nothing can read the date of is due: an app whose days cannot be
  // counted is not one the platform keeps forever.
  assertEquals(due({ at: '', by: 'p1' }, then(0)), true)
})

// `scheduled` is ONE handler for both cron triggers and tells them apart by
// the line that fired (index.ts), so the line in the config and the line in
// the code have to be the same string. They are two files; this is what keeps
// them one fact.
Deno.test('the sweep runs on a cron line the deploy actually asks for', async () => {
  let conf = parse(
    await Deno.readTextFile(new URL('./wrangler.toml', import.meta.url)),
  ) as { triggers: { crons: string[] } }
  assert(
    conf.triggers.crons.includes(DAILY),
    `${DAILY} is not in ${conf.triggers.crons.join(', ')}`,
  )
})

Deno.test('the sweep takes the trash that is out of days, and nothing else', () => {
  let apps = [
    app({ eid: 'live', slug: 'live' }),
    app({ eid: 'fresh', slug: 'fresh', trashed: { at: AT, by: 'p1' } }),
    app({ eid: 'old', slug: 'old', trashed: { at: AT, by: 'p1' } }),
  ]
  // A day before the line nothing goes; a day after, only the trashed one
  // whose thirty days ran out — the app still serving is never a candidate.
  assertEquals(overdue(apps, then(29 * day)).map((a) => a.eid), [])
  apps[2].trashed = { at: new Date(then(-31 * day)).toISOString(), by: 'p1' }
  assertEquals(overdue(apps, then(0)).map((a) => a.eid), ['old'])
})

// A person signed in on the stand-in, and the space they own — written the
// way `space_new` writes one (serving_test.ts seeds it the same way).
let ADA = 'a0000000-0000-4000-8000-0000000000ad'

let owned = async (env: Env) => {
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
  await dir.apply({
    entities: [
      { entity: { eid: ADA }, person: {} },
      {
        entity: { eid: '$space' },
        doc: { title: 'ada' },
        space: { slug: 'ada' },
      },
      {
        entity: { eid: '$seat' },
        member: { space: '$space', person: ADA, role: 'owner' },
      },
    ],
  }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
  return { dir, space: (await dir.space('ada'))! }
}

// A page's socket, as far as a replay is concerned: what it was sent.
let wire = () => {
  let sent: unknown[] = []
  return {
    sent,
    ws: {
      send: (data: string) => void sent.push(JSON.parse(data)),
      serializeAttachment: () => {},
      deserializeAttachment: () => null,
    } as unknown as Wire,
  }
}

// The two things a space keeps OUTSIDE the graph, and therefore outside the
// cascade the directory tombstone sets off (T-34371): the builder's
// conversation, in an object of its own keyed by the eid (build.ts), and the
// container that conversation compiled in (sandbox.ts, same key). `/privacy`
// says a closed space takes its things with it; this is that sentence held to
// the code.
Deno.test('a deleted space takes its conversation and its workbench', async () => {
  let box = sandboxes()
  let { env, builder } = platform('a probe secret', {
    AI: ai([{ text: 'Making it now.' }]) as Env['AI'],
    SANDBOX: box.SANDBOX as Env['SANDBOX'],
  })
  let { dir, space } = await owned(env)
  let who: Who = { person: ADA, role: 'owner' }
  let held: Held = { person: ADA, role: 'owner', space: space.eid }

  // Something said to the builder, and a workbench woken under the same key.
  await builder(space.eid).say(held, 'a recipe box please')
  assertEquals(builder(space.eid).said().length, 2)
  await boxOf(env, space, ADA, spending()).exec('cargo build')
  assertEquals([...box.alive], [`build-${space.eid}`])

  await erase(env, dir, await census(dir, space), who)

  // A page joining the object for that space hears what a first visit hears:
  // nothing but the mark that the replay is over.
  let page = wire()
  builder(space.eid).joined(page.ws, held)
  assertEquals(page.sent, [{ ready: true, building: false }])
  // And the container is gone rather than left awake on a name nobody owns.
  assertEquals([...box.alive], [])
})

slow('a space deleted: the letter, the act, and the name back', async () => {
  let k = await kernel()
  try {
    // A person with a space, an app with files and data in it, and a second
    // app so the delete has more than one of everything to take.
    let them = await seed(k, [{ slug: 'shoplab', apps: ['shop', 'notes'] }])
    let agent = connector(k, them.cookie)
    let shop = client(k, 'shoplab.yaks.app', 'shop', them.cookie)
    assertEquals((await shop.put('/index.html', '<h1>hi</h1>')).status, 200)
    await shop.applied({
      entities: [{ doc: { title: 'a note only this space has' } }],
    })
    assertEquals((await shop.get('.doc!')).length, 1)
    assertEquals((await k.at('shoplab.yaks.app', '/shop/')).status, 200)

    // The AGENT asks. It deletes nothing: it mails the owner, and says so.
    let said = await agent.tool('space_delete', { space: 'shoplab' })
    assertStringIncludes(said, 'nothing is deleted')
    assertStringIncludes(said, 'check their email')
    assertStringIncludes(said, 'https://shoplab.yaks.app/shop/')
    assertEquals((await k.at('shoplab.yaks.app', '/shop/')).status, 200)

    // The letter names what would go, and carries the link.
    let mail = await until(
      () =>
        letters(k, them.email).findLast((l) => l.subject.includes('Delete')),
      { timeout: 20_000, poll: 100, label: 'the delete letter' },
    )
    assertStringIncludes(mail!.body, 'https://shoplab.yaks.app/notes/')
    let link = /https:\/\/yaks\.app(\/space\/shoplab\/delete\?t=[^\s]+)/
      .exec(mail!.body)
    assert(link, `no confirmation link in: ${mail!.body}`)
    let at = link[1]

    // An agent cannot follow it. The door reads the session cookie and
    // nothing else, so a bearer token — the only thing an agent has — is sent
    // to sign in, and the POST that would destroy the space does nothing.
    for (let method of ['GET', 'POST']) {
      let shut = await k.at('yaks.app', at, {
        method,
        redirect: 'manual',
        headers: { authorization: 'Bearer whatever-an-agent-holds' },
      })
      assertEquals(shut.status, 302)
      assertStringIncludes(shut.headers.get('location') ?? '', '/login')
      await shut.body?.cancel()
    }
    assertEquals((await k.at('shoplab.yaks.app', '/shop/')).status, 200)

    // Somebody else signed in is told what a stranger is told about a space
    // that does not exist.
    let stranger = await seed(k, [])
    let no = await k.at('yaks.app', at, {
      headers: { cookie: stranger.cookie },
    })
    assertEquals(no.status, 404)
    await no.body?.cancel()

    // The owner opens it: the page names everything that would go, and the
    // GET alone changes nothing — a mail client that follows every link in a
    // letter must not be able to delete a space.
    let page = await (await k.at('yaks.app', at, {
      headers: { cookie: them.cookie },
    })).text()
    assertStringIncludes(page, 'What goes, for good')
    assertStringIncludes(page, 'https://shoplab.yaks.app/shop/')
    assertEquals((await k.at('shoplab.yaks.app', '/shop/')).status, 200)

    // And confirms.
    let form = (fields: Record<string, string>) =>
      k.at('yaks.app', '/space/shoplab/delete', {
        method: 'POST',
        headers: {
          cookie: them.cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields).toString(),
      })
    let gone = await form({ t: at.split('t=')[1] })
    assertEquals(gone.status, 200)
    assertStringIncludes(await gone.text(), 'shoplab.yaks.app is gone')

    // What is gone. The directory first: the space, its apps, and every
    // membership of it — one tombstone, the store's own cascade.
    let dir = meta(k, them.cookie)
    assertEquals(await dir.query(`id=${them.eids.shoplab}`), [])
    assertEquals(await dir.query(`.app.space=${them.eids.shoplab}`), [])
    assertEquals(await dir.query(`.member.space=${them.eids.shoplab}`), [])

    // Then the name, which is back in circulation: somebody else takes it,
    // and what they get is EMPTY — no files under the address, and a store
    // with none of the last space's rows in it. The store is named for the
    // address an app was born at (directory.ts storeName), so this is the
    // proof that matters for releasing a slug at all.
    let next = await seed(k, [{ slug: 'shoplab', apps: ['shop'] }])
    let theirs = client(k, 'shoplab.yaks.app', 'shop', next.cookie)
    assertEquals(await theirs.get('.doc!'), [])
    assertEquals((await k.at('shoplab.yaks.app', '/shop/')).status, 404)
  } finally {
    await k.stop()
  }
})

// The daily sweep (wrangler.toml `[triggers] crons`, index.ts `scheduled`):
// what it takes, and — the half that matters — what it leaves. An app inside
// its thirty days is a person's app that they can still have back, and a sweep
// that took one early would be the bug this whole feature exists to prevent.
slow(
  'the sweep erases the trash that is out of days, and only that',
  async () => {
    let { env } = platform('a probe secret')
    let { dir, space } = await owned(env)
    let make = async (slug: string, over: Record<string, unknown> = {}) => {
      await dir.apply({
        entities: [{
          entity: { eid: `$${slug}` },
          doc: { title: slug },
          app: { slug, space: space.eid, version: 1, access: 'public' },
          alias: { slug: `ada/${slug}` },
          ...over,
        }],
      }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
      let app = (await dir.app(space, slug))!
      // A file of its own, so what the erase takes is visible in the bucket.
      await r2Blobs(env.BLOBS).put(
        `ada/${slug}/index.html`,
        new TextEncoder().encode(`<h1>${slug}</h1>`),
      )
      return app
    }
    let ago = (days: number) => ({
      trashed: { at: new Date(Date.now() - days * day).toISOString(), by: ADA },
    })

    await make('live')
    await make('fresh', ago(29))
    await make('old', ago(31))

    assertEquals(await collected(env), 1)
    assertEquals((await dir.apps(space)).map((a) => a.slug), ['live', 'fresh'])
    // The bytes went with the row, and only that app's.
    let keys = await r2Blobs(env.BLOBS).list('ada/')
    assertEquals(keys.some((k) => k.startsWith('ada/old/')), false)
    assertEquals(keys.some((k) => k.startsWith('ada/fresh/')), true)
    // A second run has nothing to do, and the app still in its days is still
    // there to be restored.
    assertEquals(await collected(env), 0)
    // Until its own day comes: the clock is the argument, so the sweep can be
    // asked what it would do a month from now.
    assertEquals(await collected(env, new Date(Date.now() + 2 * day)), 1)
    assertEquals((await dir.apps(space)).map((a) => a.slug), ['live'])
  },
)

slow('a space with a domain attached refuses to die quietly', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'domainlab', apps: ['shop'] }])
    let dir = meta(k, them.cookie)
    // A custom hostname, as domain_attach would have written it. This kernel
    // has no Cloudflare token, so nothing here can give the hostname back —
    // and a delete that buried the row anyway would leave a billable custom
    // hostname nobody remembers (T-33038).
    await dir.apply([{
      hostname: {
        name: 'herbusiness.com',
        app: them.eids['domainlab/shop'],
        stage: 'active',
      },
    }])
    let out = await k.at('yaks.app', '/space/domainlab/delete', {
      method: 'POST',
      headers: {
        cookie: them.cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ confirm: 'domainlab' }).toString(),
    })
    assertEquals(out.status, 502)
    let said = await out.text()
    assertStringIncludes(said, 'did not finish')
    assertStringIncludes(said, 'CF_HOSTNAMES_TOKEN')
    // Nothing went: the space, its app and its hostname all still stand.
    assertEquals((await dir.query(`id=${them.eids.domainlab}`)).length, 1)
    assertEquals((await dir.query('.hostname!')).length, 1)
    assertEquals(
      (await dir.query(`.app.space=${them.eids.domainlab}`)).length,
      1,
    )
  } finally {
    await k.stop()
  }
})

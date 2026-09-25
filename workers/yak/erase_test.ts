// Closing a space (T-33166): the pure seams — what the ticket in the letter
// is worth, what the page and the letter say a delete would destroy, and the
// two spaces that may not be deleted at all — then what the act takes with it
// outside the graph over testing.ts's stand-in (T-34371). The whole act, in
// workerd, is erase_workerd_test.ts's.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parse } from '@std/toml'
import { next } from '@yaks/wake'
import { r2Objects } from './lib/objects.ts'
import type { Wire } from '@yaks/durable-object'
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
  keeping,
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
import { ai, platform, sandboxes } from './testing.ts'
import { boxOf, spending } from './sandbox.ts'
import type { Who } from './session.ts'
import { trashPlugin } from './trash.ts'

let space = (over: Partial<Space> = {}): Space => ({
  eid: 'space-eid',
  slug: 'shoplab',
  title: 'shoplab',
  tier: 'free',
  plan: null,
  stripe: null,
  fee: 0,
  meter: null,
  told: false,
  trashed: null,
  slugs: [],
  tunnel: null,
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
  gallery: null,
  seeded: null,
  trashed: null,
  theme: null,
  ...over,
})

let host = (name: string): Host => ({
  eid: `host-${name}`,
  name,
  serves: 'app-eid',
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

// Which act the link opens rides inside the signature (T-34431), so the only
// way to reach the erase is a letter the platform sent: a link off the web,
// or one somebody edited, opens the trash.
Deno.test('a ticket carries whether it erases or trashes', async () => {
  let secret = 'shhh'
  let mild = await ticketed(await ticket(space(), 'p1', secret), secret)
  assertEquals(mild?.forever, false)
  let final = await ticketed(await ticket(space(), 'p1', secret, true), secret)
  assertEquals(final?.forever, true)
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
  let l = letter(doomed(), door('shoplab', 'tkt'), true)
  assertEquals(l.subject, 'Delete shoplab.yaks.app?')
  assertStringIncludes(l.body, 'https://yaks.app/space/shoplab/delete?t=tkt')
  assertStringIncludes(l.body, 'the next hour')
  assertStringIncludes(l.body, 'The Shop (https://shoplab.yaks.app/shop/)')
  assertStringIncludes(l.body, 'It cannot be undone')
})

// What a trash says is a different list, not a softer wording of that one
// (T-34431): every line names something that stops, and the last one is the
// opposite of the last line above — the address is held, never released.
Deno.test('a space in the trash is told what stops, not what is destroyed', () => {
  let d = doomed({ hosts: [host('herbusiness.com')] })
  let said = keeping(d).join('\n')
  assertStringIncludes(
    said,
    'The Shop (https://shoplab.yaks.app/shop/) stops answering',
  )
  assertStringIncludes(said, 'everything it has saved are kept')
  assertStringIncludes(said, 'herbusiness.com stops serving until')
  assertStringIncludes(said, 'shoplab.yaks.app is held for you for 30 days')
  assertEquals(said.includes('back into circulation'), false)
  // And the letter is the act its ticket carries, one list or the other.
  let l = letter(d, door('shoplab', 'tkt'))
  assertStringIncludes(l.body, 'puts the space in the trash for 30 days')
  assertStringIncludes(l.body, 'stops answering')
  assertEquals(l.body.includes('It cannot be undone'), false)
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

// The trash row owns its schedule outright: there is no heartbeat to line it
// up with any more (D-37562), and the instant the directory's alarm is set to
// is the one this row names.
Deno.test('the trash wake names 04:20 UTC and nothing coarser rounds it off', async () => {
  let conf = parse(
    await Deno.readTextFile(new URL('./wrangler.toml', import.meta.url)),
  ) as { triggers?: unknown }
  // Empty, not absent: a deploy leaves a Worker's crons alone when absent.
  assertEquals(conf.triggers, { crons: [] })
  assertEquals(trashPlugin.wakes?.[0].wake.every, DAILY)
  let before = Date.parse('2026-09-07T04:19:00Z')
  assertEquals(next(DAILY, before), '2026-09-07T04:20:00.000Z')
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

// A space wears the same word and is counted out of the trash by the same
// days (T-34431) — one selection, asked of whichever rows the sweep is
// holding, because "thirty days ago" cannot be allowed to mean two things.
Deno.test('a space out of days is taken the same way an app is', () => {
  let spaces = [
    space({ eid: 'live', slug: 'live' }),
    space({ eid: 'fresh', slug: 'fresh', trashed: { at: AT, by: 'p1' } }),
    space({
      eid: 'old',
      slug: 'old',
      trashed: { at: new Date(then(-31 * day)).toISOString(), by: 'p1' },
    }),
  ]
  assertEquals(overdue(spaces, then(0)).map((s) => s.eid), ['old'])
  // The space still in its days is taken on the day they run out, and never
  // before: a space erased early is the bug this whole feature prevents.
  assertEquals(overdue(spaces, then(30 * day - 1)).map((s) => s.eid), ['old'])
  assertEquals(overdue(spaces, then(30 * day)).map((s) => s.eid), [
    'fresh',
    'old',
  ])
})

// A person signed in on the stand-in, and the space they own — written the
// way `space_new` writes one (serving_test.ts seeds it the same way).
let ADA = 'a0000000-0000-4000-8000-0000000000ad'

let by = { 'x-yak-person': ADA, 'x-yak-role': 'owner' }

// One space of theirs, with whatever else it wears — a trash mark, in the
// sweep's tests.
let makes = async (
  dir: ReturnType<typeof directory>,
  slug: string,
  over: Record<string, unknown> = {},
) => {
  await dir.apply({
    entities: [
      { entity: { eid: ADA }, person: {} },
      {
        entity: { eid: '$space' },
        doc: { title: slug },
        space: { slug },
        ...over,
      },
      {
        entity: { eid: '$seat' },
        member: { space: '$space', person: ADA, role: 'owner' },
      },
    ],
  }, by)
  return (await dir.space(slug))!
}

let owned = async (env: Env) => {
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
  return { dir, space: await makes(dir, 'ada') }
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

// The two things a space keeps outside the graph, and therefore outside the
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

// The daily sweep (the `yak-trash` wake row, fired by the directory's alarm):
// what it takes, and — the half that matters — what it leaves. An app inside
// its thirty days is a person's app that they can still have back, and a sweep
// that took one early would be the bug this whole feature exists to prevent.
Deno.test(
  'the sweep erases the trash that is out of days, and only that',
  async () => {
    let { env } = platform('a probe secret')
    let { dir, space } = await owned(env)
    let make = async (slug: string, over: Record<string, unknown> = {}) => {
      await dir.apply({
        entities: [{
          entity: { eid: `$${slug}` },
          doc: { title: slug },
          app: {
            slug,
            space: space.eid,
            version: 1,
            access: 'public',
            store: `ada/${slug}.aaa111`,
          },
          former: { slug },
          ...over,
        }],
      }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
      let app = (await dir.app(space, slug))!
      // A file of its own, so what the erase takes is visible in the bucket.
      await r2Objects(env.BLOBS).put(
        `ada/${slug}/index.html`,
        new TextEncoder().encode(`<h1>${slug}</h1>`),
      )
      return app
    }
    let ago = (days: number) => ({
      trashed: { at: new Date(Date.now() - days * day).toISOString(), by: ADA },
    })

    let live = await make('live')
    await make('fresh', ago(29))
    await make('old', ago(31))
    // A title from before the one-line rule (T-37885).
    await dir.apply({
      entities: [{
        entity: { eid: live.eid },
        doc: { title: `Live\n\n## Heading ${'x'.repeat(100)}` },
      }],
    }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
    // Notes under the name they had before T-34632 (T-37888).
    await r2Objects(env.BLOBS).put(
      'ada/live/AGENTS.md',
      new TextEncoder().encode('grams'),
    )

    assertEquals(await collected(env), 1)
    assertEquals(
      (await dir.app(space, 'live', true))!.title,
      `Live ## Heading ${'x'.repeat(64)}`,
    )
    // The notes are under the one name read now, and the old one is gone.
    assertEquals(
      new TextDecoder().decode(
        (await r2Objects(env.BLOBS).read('ada/live/NOTES.md'))!,
      ),
      'grams',
    )
    assertEquals(await r2Objects(env.BLOBS).has('ada/live/AGENTS.md'), false)
    assertEquals((await dir.apps(space)).map((a) => a.slug), ['live', 'fresh'])
    // The bytes went with the row, and only that app's.
    let keys = await r2Objects(env.BLOBS).list('ada/')
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

// And the same sweep on the row above (T-34431): a space out of days goes
// whole, taking its apps and their bytes with it, while a space still inside
// its thirty days is a space its person can still have back.
Deno.test(
  'the sweep erases a space out of days, and leaves one in them',
  async () => {
    let { env } = platform('a probe secret')
    let { dir } = await owned(env)
    let ago = (days: number) => ({
      trashed: { at: new Date(Date.now() - days * day).toISOString(), by: ADA },
    })
    let app = async (space: Space, slug: string) => {
      await dir.apply({
        entities: [{
          entity: { eid: `$${slug}` },
          doc: { title: slug },
          app: {
            slug,
            space: space.eid,
            version: 1,
            access: 'public',
            store: `${space.slug}/${slug}.aaa111`,
          },
          former: { slug },
        }],
      }, by)
      await r2Objects(env.BLOBS).put(
        `${space.slug}/${slug}/index.html`,
        new TextEncoder().encode(`<h1>${slug}</h1>`),
      )
    }
    await app(await makes(dir, 'fresh', ago(29)), 'notes')
    await app(await makes(dir, 'old', ago(31)), 'notes')

    assertEquals(await collected(env), 1)
    assertEquals(await dir.space('old'), null)
    assert(await dir.space('fresh'))
    assert(await dir.space('ada'))
    // The app in it went with it, and so did its bytes — one erase, the same
    // one a person confirming `forever` runs.
    let keys = await r2Objects(env.BLOBS).list('')
    assertEquals(keys.some((k) => k.startsWith('old/')), false)
    assertEquals(keys.some((k) => k.startsWith('fresh/')), true)
    // A second run has nothing to do, and the space still in its days waits
    // for its own day: the clock is the argument.
    assertEquals(await collected(env), 0)
    assertEquals(await collected(env, new Date(Date.now() + 2 * day)), 1)
    assertEquals(await dir.space('fresh'), null)
    assert(await dir.space('ada'))
  },
)

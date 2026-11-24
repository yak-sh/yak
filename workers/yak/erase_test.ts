// Closing a space (T-33166): the pure seams — what the ticket in the letter
// is worth, what the page and the letter say a delete would destroy, and the
// two spaces that may not be deleted at all — then what the act takes with it
// outside the graph over SQLite and Builder fixtures (T-34371). The whole act,
// through the kernel, is erase_kernel_test.ts's.
import { cleanup, test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parse } from 'smol-toml'
import { next } from '@yaks/wake'
import { r2Objects, r2RawObjects } from './lib/objects.ts'
import { staged } from './release.ts'
import { addressed } from '@yaks/platform/versions'
import { digest } from '@yaks/graph/sha256'
import { blobPrefix, receiptPrefix, uploadPrefix } from './blob-key.ts'
import type { Wire } from '@yaks/durable-object'
import {
  abandoned,
  collected,
  DAILY,
  type Doomed,
  doomed as census,
  door,
  erase,
  keeping,
  letter,
  LIFE,
  naming,
  refused,
  ticket,
  ticketed,
  trashSpace,
} from './erase.ts'
import {
  daysLeft,
  directory,
  due,
  GRACE,
  overdue,
  ranked,
} from './directory.ts'
import { PLATFORM_OBJECT } from './door.ts'
import { MORE } from './wake.ts'
import * as dirPart from './directory.ts'
import type { App, Host, Space } from './directory.ts'
import type { Env } from './env.ts'
import { declared } from './directory-fixture.ts'
import { sandboxes } from '../../packages/sandbox/testing.ts'
import { kvStorage } from './binding-probe.ts'
import { builders } from './builder-probe.ts'
import { operatorStore } from './operator-store.ts'
import { durable } from './store-state-probe.ts'
import { platform as directoryPlatform } from './directory-rows-probe.ts'
import { platform } from './deploy-probe.ts'
import { spending, workbench } from './sandbox.ts'
import { named } from '@yaks/sandbox/cloudflare'
import type { Who } from './session.ts'
import { KERNEL, meta } from './meta.ts'
import { call } from './tools.ts'

let space = (over: Partial<Space> = {}): Space => ({
  operator: 'Wren',
  eid: 'space-eid',
  slug: 'shoplab',
  store: 'shoplab',
  title: 'shoplab',
  tier: 'free',
  plan: null,
  seller: null,
  fee: 0,
  budget: null,
  meter: null,
  told: false,
  trashed: null,
  slugs: [],
  tunnel: null,
  ...over,
})

let app = (over: Partial<App> = {}): App => ({
  policy: 0,
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
  screenshot: null,
  seeded: null,
  trashed: null,
  theme: null,
  ...over,
})

let host = (name: string): Host => ({
  verification: null,
  verified: null,
  to: null,
  mail: null,
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
  lines: [],
  members: [{ person: 'p1', name: 'Dana' }],
  ...over,
})

let line = {
  trashed: null,
  eid: 'line-eid',
  number: '+18335550100',
  via: 'telnyx',
  space: 'space-eid',
  upfront: 1,
  monthly: 1.5,
  at: '',
  verification: null,
  sms: true,
  voice: true,
  campaign: null,
}

let ticketSecret = 'shhh'
let spaceTicket = await ticket(space(), 'p1', ticketSecret)
test('a ticket opens one space for one person, for an hour', async () => {
  let secret = ticketSecret
  let t = spaceTicket
  let open = await ticketed(t, secret)
  assertEquals(open?.space, 'space-eid')
  assertEquals(open?.person, 'p1')
  // Dead an hour on.
  assertEquals(await ticketed(t, secret, Date.now() + LIFE + 1000), null)
})

test('a ticket under another secret or after any edit opens nothing', async () => {
  let t = spaceTicket, secret = ticketSecret
  assertEquals(await ticketed(t, 'another secret'), null)
  assertEquals(await ticketed(`${t}x`, secret), null)
  assertEquals(await ticketed('not a ticket', secret), null)
})

// Which act the link opens rides inside the signature (T-34431), so the only
// way to reach the erase is a letter the platform sent: a link off the web,
// or one somebody edited, opens the trash.
test('a ticket carries whether it erases or trashes', async () => {
  let secret = 'shhh'
  let mild = await ticketed(await ticket(space(), 'p1', secret), secret)
  assertEquals(mild?.forever, false)
  let final = await ticketed(await ticket(space(), 'p1', secret, true), secret)
  assertEquals(final?.forever, true)
})

test('a space erase letter keeps a held number through the space trash grace', () => {
  let sent = letter(
    doomed({ lines: [line] }),
    'https://example.org/confirm',
    true,
  )
  assertStringIncludes(sent.body, 'puts the space in the trash')
  assertStringIncludes(sent.body, 'costs $1.50 a month until it is erased')
  assert(!sent.body.includes('It cannot be undone'))
})

test('what a delete would destroy is named, not counted', () => {
  let lines = naming(doomed({
    apps: [app(), app({ eid: 'b', slug: 'notes', title: 'Notes' })],
    hosts: [host('herbusiness.com')],
    lines: [line],
    members: [{ person: 'p1', name: 'Dana' }, { person: 'p2', name: 'Sam' }],
  }))
  let said = lines.join('\n')
  assertStringIncludes(said, 'The Shop (https://shoplab.yaks.app/shop/)')
  assertStringIncludes(said, 'Notes (https://shoplab.yaks.app/notes/)')
  assertStringIncludes(said, 'herbusiness.com stops serving')
  assertStringIncludes(
    said,
    '(833) 555-0100 will be returned to the phone company automatically',
  )
  assertStringIncludes(said, '2 people lose their way in: Dana, Sam')
  assertStringIncludes(said, 'shoplab.yaks.app goes back into circulation')
  // One member is the owner reading the letter; there is nobody to warn about.
  assert(!naming(doomed()).some((l) => l.includes('lose their way in')))
  // And the letter says the same words, with the link and the hour.
  let l = letter(
    doomed({ space: space({ trashed: { at: AT, by: 'p1' } }) }),
    door('shoplab', 'tkt'),
    true,
  )
  assertEquals(l.subject, 'Delete shoplab.yaks.app?')
  assertStringIncludes(l.body, 'https://yaks.app/space/shoplab/delete?t=tkt')
  assertStringIncludes(l.body, 'the next hour')
  assertStringIncludes(l.body, 'The Shop (https://shoplab.yaks.app/shop/)')
  assertStringIncludes(l.body, 'It cannot be undone')
})

// What a trash says is a different list, not a softer wording of that one
// (T-34431): every line names something that stops, and the last one is the
// opposite of the last line above — the address is held, never released.
test('a space in the trash is told what stops, not what is destroyed', () => {
  let d = doomed({ hosts: [host('herbusiness.com')], lines: [line] })
  let said = keeping(d).join('\n')
  assertStringIncludes(
    said,
    'The Shop (https://shoplab.yaks.app/shop/) stops answering',
  )
  assertStringIncludes(said, 'everything it has saved are kept')
  assertStringIncludes(said, 'herbusiness.com stops serving until')
  assertStringIncludes(said, "(833) 555-0100 stays the space's, and costs")
  assertStringIncludes(
    said,
    'shoplab.yaks.app is held for you while in the trash',
  )
  assertEquals(said.includes('back into circulation'), false)
  // And the letter is the act its ticket carries, one list or the other.
  let l = letter(d, door('shoplab', 'tkt'))
  assertStringIncludes(l.body, 'puts the space in the trash')
  assertStringIncludes(l.body, 'stops answering')
  assertEquals(l.body.includes('It cannot be undone'), false)
})

test('the platform and a paying space refuse to be deleted', async () => {
  assertEquals(await refused(space(), {}), '')
  assertStringIncludes(
    await refused(space({ slug: 'yak' }), {}),
    'the platform itself',
  )
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
  assertStringIncludes(
    await refused(paying, {}),
    'Cancel the subscription first',
  )
  // Cancelled at Stripe, the row stays and the space may go.
  assertEquals(
    await refused(space({ plan: { ...paying.plan!, status: 'canceled' } }), {}),
    '',
  )
})

// The trash's two numbers (T-34430): how long is left, and whether the sweep
// takes it. A day is a day everywhere — the tool says it, the space page says
// it, `/privacy` says it — so it is counted in one place.
let AT = '2026-09-05T12:00:00.000Z'
let day = 86_400_000
let then = (ms: number) => Date.parse(AT) + ms

// Each app as `slug:born` or `slug:born:restored`, by day of the month.
let homes = (...apps: string[]) =>
  ranked(apps.map((one) => {
    let [slug, born, back] = one.split(':')
    let day = (d: string) => `2026-11-${d.padStart(2, '0')}T00:00:00.000Z`
    return app({
      slug,
      born: day(born),
      untrashed: back ? { at: day(back), by: 'p1' } : null,
    })
  })).map((a) => a.slug)

test('apps home words oldest first, a restored one as old as its restore', () => {
  // Birth order, whatever order the directory read them in.
  assertEquals(homes('menu:18', 'garden:3'), ['garden', 'menu'])
  // A restored app ranks behind an app born while it was in the trash, and
  // ahead of every app born after it came back.
  assertEquals(
    homes('menu:1:10', 'potluck:5', 'third:12'),
    ['potluck', 'menu', 'third'],
  )
})

test('the trash is thirty days, counted in whole days left', () => {
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
test('the trash wake names 04:20 UTC and nothing coarser rounds it off', async () => {
  let conf = parse(
    await Deno.readTextFile(new URL('./wrangler.toml', import.meta.url)),
  ) as { triggers?: unknown }
  // Empty, not absent: a deploy leaves a Worker's crons alone when absent.
  assertEquals(conf.triggers, { crons: [] })
  let before = Date.parse('2026-09-07T04:19:00Z')
  assertEquals(next(DAILY, before), '2026-09-07T04:20:00.000Z')
})

test('the sweep takes the trash that is out of days, and nothing else', () => {
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
test('a space out of days is taken the same way an app is', () => {
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
        space: { slug, store: slug },
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
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) })
  return { dir, space: await makes(dir, 'ada') }
}

let idlePreview = await (async () => {
  await using p = platform('idle preview')
  let g = meta(p.env)
  let now = new Date()
  let old = new Date(now.getTime() - 8 * day).toISOString()
  let person = 'idle-bot'
  await g.apply(
    [
      {
        entity: { eid: person },
        person: {},
        email: { address: 'idle@bot.yak.sh' },
      },
      ...['quiet', 'used'].flatMap((slug) => [
        {
          entity: { eid: slug },
          space: { slug, store: slug },
          created: { at: old, by: person },
        },
        {
          entity: { eid: `${slug}-seat` },
          member: { space: slug, person, role: 'owner' },
          created: { at: old, by: person },
        },
        {
          entity: { eid: `${slug}-app` },
          app: {
            space: slug,
            slug: 'notes',
            access: 'private',
            draft: `${slug}-draft`,
          },
          created: { at: old, by: person },
        },
      ]),
    ],
    KERNEL,
    { stamp: false },
  )
  let touches = ['quiet', 'quiet-seat', 'quiet-app', 'used', 'used-app']
    .map((eid) => ({ entity: { eid }, doc: { title: 'Platform bookkeeping' } }))
  await g.apply(touches, KERNEL)
  await g.apply([{
    entity: { eid: 'quiet-app' },
    meter: { requests: 100, rows_written: 100, at: now.toISOString() },
  }], KERNEL)
  // An edit somebody made before the idle window began is no use now.
  await g.apply(
    [{
      entity: { eid: 'quiet-edit' },
      written: {
        app: 'quiet-app',
        path: 'NOTES.md',
        sha: 'a'.repeat(64),
        at: old,
        by: person,
      },
      created: { at: old, by: person },
    }],
    KERNEL,
    { stamp: false },
  )
  await g.apply([{
    entity: { eid: 'platform-reference' },
    memory: { space: 'quiet' },
    doc: { title: 'Platform bookkeeping' },
  }], KERNEL)
  // Selection must never enter an app Store, including a dormant one.
  let ns = p.env.STORE
  p.env.STORE = {
    idFromName: (name) => {
      assertEquals(name, PLATFORM_OBJECT)
      return ns.idFromName(name)
    },
    get: (id) => ns.get(id),
  }
  let before = await abandoned(p.env, now)
  let dir = directory({ fetch: (r) => dirPart.fetch(r, p.env) })
  await call({ env: p.env, dir, person }, 'app_files', {
    space: 'used',
    app: 'notes',
    path: 'index.html',
    content: 'A person edited their existing draft',
  })
  // A later platform write must preserve the independent evidence of use.
  await g.apply(touches, KERNEL)
  return { before, after: await abandoned(p.env, new Date()) }
})()

test('the idle preview ignores platform touches but keeps a space somebody used', () => {
  assertEquals(idlePreview, { before: ['quiet', 'used'], after: ['quiet'] })
})

// The two things a space keeps outside the graph, and therefore outside the
// cascade the directory tombstone sets off (T-34371): the Operator's store,
// in an object of its own keyed by the eid (build.ts), and the workbench
// (sandbox.ts, same key). `/privacy`
// says a closed space takes its things with it; this is that sentence held to
// the code.
test('a deleted space takes its conversation and its workbench', async () => {
  let box = sandboxes()
  let stores: ReturnType<typeof durable>[] = []
  let { builder, namespace } = builders(() => env, () => {
    let storage = Object.assign(durable(), kvStorage())
    stores.push(storage)
    cleanup(() => storage[Symbol.dispose]())
    let live: Wire[] = []
    return {
      storage,
      acceptWebSocket: (ws) => void live.push(ws),
      getWebSockets: () => live,
    }
  })
  let { env } = directoryPlatform('a probe secret', {
    BUILDER: namespace,
    WORKBENCH: box.WORKBENCH as Env['WORKBENCH'],
  })
  let { dir, space } = await owned(env)
  let who: Who = { person: ADA, role: 'owner' }

  // The space's Operator, read and holding a row, and a workbench woken
  // under the same key.
  let read = await builder(space.eid).fetch(
    new Request('https://builder/operator/conversation', {
      method: 'POST',
      headers: { 'x-space-eid': space.eid, 'x-yak-person': ADA },
      body: '{}',
    }),
  )
  await read.body?.cancel()
  let operator = await operatorStore(stores[0])
  await operator.g.apply([{
    entity: { eid: crypto.randomUUID() },
    session: {},
  }], {
    trusted: true,
  })
  // What the Operator's store holds, as entities.
  let kept = () =>
    stores.flatMap((st) =>
      [...st.sql.exec('select name from sqlite_master')].some((r) =>
          r.name == 'entity'
        )
        ? [...st.sql.exec('select eid from entity')]
        : []
    ).length
  assert(kept(), 'the Operator kept nothing')
  let bench = await workbench(env, space, ADA, spending())
  await bench.provider.exec(bench.ref, 'cargo build')
  assertEquals([...box.alive], [named(space.eid, ADA)])

  await trashSpace(env, dir, space, who)
  await erase(env, dir, await census(dir, (await dir.space(space.slug))!), who)

  // The Operator's store is gone with the space, and the container rather
  // than left awake on a name nobody owns.
  assertEquals(kept(), 0)
  assertEquals([...box.alive], [])
})

test('a space enters trash before a separate permanent purge', async () => {
  await using p = platform('trash first')
  let { dir, space } = await owned(p.env)
  await dir.apply({
    entities: [{
      entity: { eid: '$source' },
      doc: { title: 'source' },
      app: { slug: 'source', space: space.eid, version: 1, access: 'public' },
    }],
  }, by)
  let source = (await dir.app(space, 'source'))!
  await declared(p.env, space, source)
  let bytes = r2Objects(p.env.BLOBS)
  let own = uploadPrefix(blobPrefix(space, source)) + 'recovery'
  let adopted = uploadPrefix('.visits/adopted/blobs/') + 'recovery'
  let legacy = `.uploads/${source.eid}/recovery`
  for (let key of ['ada/precious', own, adopted, legacy]) {
    await bytes.put(key, new TextEncoder().encode('saved work'))
  }
  let out = await erase(p.env, dir, await census(dir, space), {
    person: ADA,
    role: 'owner',
  })
  assert(out.trashed)
  assert((await dir.space('ada'))?.trashed)
  assert(await bytes.has('ada/precious'))
  let retained = (await dir.space('ada'))!
  await erase(p.env, dir, await census(dir, retained), {
    person: ADA,
    role: 'owner',
  })
  assertEquals(await dir.space('ada'), null)
  assertEquals(await bytes.has('ada/precious'), false)
  assertEquals(await bytes.has(own), false)
  assertEquals(await bytes.has(adopted), true)
  assertEquals(await bytes.has(legacy), true)
})

// The daily sweep (the `yak-trash` wake row, fired by the directory's alarm):
// what it takes, and — the half that matters — what it leaves. An app inside
// its thirty days is a person's app that they can still have back, and a sweep
// that took one early would be the bug this whole feature exists to prevent.
test(
  'the sweep retains old trash and every app byte',
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
      await declared(env, space, app)
      // Bytes of its own, so what the erase takes is visible in the bucket.
      await r2Objects(env.BLOBS).put(
        `ada/${slug}/blobs/${'0'.repeat(64)}`,
        new TextEncoder().encode(`${slug} photo`),
      )
      await r2Objects(env.BLOBS).put(
        receiptPrefix(app) + 'recording',
        new TextEncoder().encode('private provider output'),
      )
      return app
    }
    let ago = (days: number) => ({
      trashed: { at: new Date(Date.now() - days * day).toISOString(), by: ADA },
    })

    let live = await make('live')
    let fresh = await make('fresh', ago(29))
    let old = await make('old', ago(31))
    // A title from before the one-line rule (T-37885).
    await dir.apply({
      entities: [{
        entity: { eid: live.eid },
        doc: { title: `Live\n\n## Heading ${'x'.repeat(100)}` },
      }],
    }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })

    // A run out of time stops before the next piece of work and leaves it
    // for the run after (wake.ts `STEP`).
    assertEquals(await collected(env, new Date(), () => true), MORE)
    assertEquals((await dir.apps(space)).length, 3)
    assertEquals(await collected(env), 0)
    assertEquals(
      (await dir.app(space, 'live'))!.title,
      `Live ## Heading ${'x'.repeat(64)}`,
    )
    assertEquals((await dir.apps(space)).map((a) => a.slug), [
      'live',
      'fresh',
      'old',
    ])
    // The bytes went with the row, and only that app's.
    let keys = await r2Objects(env.BLOBS).list('ada/')
    assertEquals(keys.some((k) => k.startsWith('ada/old/')), true)
    assertEquals(keys.some((k) => k.startsWith('ada/fresh/')), true)
    assertEquals(
      await r2Objects(env.BLOBS).has(receiptPrefix(old) + 'recording'),
      true,
    )
    assertEquals(
      await r2Objects(env.BLOBS).has(receiptPrefix(fresh) + 'recording'),
      true,
    )
    assertEquals(
      await r2Objects(env.BLOBS).has(receiptPrefix(live) + 'recording'),
      true,
    )
    // A second run has nothing to do, and the app still in its days is still
    // there to be restored.
    assertEquals(await collected(env), 0)
    // Until its own day comes: the clock is the argument, so the sweep can be
    // asked what it would do a month from now.
    assertEquals(await collected(env, new Date(Date.now() + 2 * day)), 0)
    assertEquals((await dir.apps(space)).map((a) => a.slug), [
      'live',
      'fresh',
      'old',
    ])
  },
)

// The sweep's marks come from every app's referrers at once (written.ts
// `pruned`): a deploy's manifest, its release's index, and the history a
// path keeps. Only bytes none of them names go to the trash.
test('the sweep retires only the bytes no app names', async () => {
  let { env } = platform('a probe secret')
  let { dir, space } = await owned(env)
  let raw = r2RawObjects(env.BLOBS)
  let stored = async (text: string) => {
    let bytes = new TextEncoder().encode(text)
    let sha = await digest(bytes)
    await raw.put(addressed(sha), bytes)
    return sha
  }
  let app = async (home: Space, slug: string) => {
    await dir.apply({
      entities: [{
        entity: { eid: '$app' },
        app: { slug, space: home.eid, version: 1, access: 'public' },
        former: { slug },
      }],
    }, by)
    return (await dir.app(home, slug))!
  }
  let shipped = await stored('<h1>shipped</h1>')
  let one = await app(space, 'shop')
  let source = `ada/.releases/${one.eid}/${crypto.randomUUID()}`
  let release = staged(raw, { 'index.html': shipped }, source)
  await release.files.put(
    `${source}/esbuild/app.js`,
    new TextEncoder().encode('compiled'),
  )
  let drafted = await stored('a draft another space holds')
  let two = await app(await makes(dir, 'bob'), 'notes')
  await meta(env).apply([
    {
      entity: { eid: '$deploy' },
      deploy: {
        app: one.eid,
        version: 1,
        files: JSON.stringify(await release.finish()),
        source,
        worker: '',
      },
    },
    { entity: { eid: one.eid }, app: { source } },
    {
      entity: { eid: '$write' },
      written: {
        app: two.eid,
        path: 'notes.md',
        sha: drafted,
        at: new Date().toISOString(),
        by: ADA,
      },
    },
  ], KERNEL)
  let orphan = await stored('nobody names this')
  await collected(env, new Date(Date.now() + 2 * day))
  let retired = (await meta(env).query('.file_retirement'))
    .flatMap((r) => (r.file_retirement as { keys: string[] }).keys)
  assertEquals(retired, [addressed(orphan)])
})

test('the sweep keeps a reviewer space and its trash', async () => {
  let { env } = platform('a probe secret')
  let { dir } = await owned(env)
  let old = {
    trashed: { at: new Date(Date.now() - 31 * day).toISOString(), by: ADA },
  }
  let space = await makes(dir, 'claude-review')
  for (let [slug, over] of [['recipes', {}], ['garden', old]] as const) {
    await dir.apply({
      entities: [{
        entity: { eid: `$${slug}` },
        doc: { title: slug },
        app: {
          slug,
          space: space.eid,
          version: 1,
          access: 'public',
          store: `claude-review/${slug}.aaa111`,
        },
        former: { slug },
        ...over,
      }],
    }, by)
    await declared(env, space, (await dir.app(space, slug))!)
  }
  await collected(env, new Date(Date.now() + 400 * day))
  assert(await dir.space('claude-review'))
  assertEquals((await dir.apps(space)).map((a) => a.slug), [
    'recipes',
    'garden',
  ])
})

// And the same sweep on the row above (T-34431): a space out of days goes
// whole, taking its apps and their bytes with it, while a space still inside
// its thirty days is a space its person can still have back.
test(
  'the sweep keeps old space trash and trashes idle test spaces',
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

    assertEquals(await collected(env), 0)
    assert((await dir.space('old'))?.trashed)
    assert(await dir.space('fresh'))
    assert(await dir.space('ada'))
    // The app in it went with it, and so did its bytes — one erase, the same
    // one a person confirming `forever` runs.
    let keys = await r2Objects(env.BLOBS).list('')
    assertEquals(keys.some((k) => k.startsWith('old/')), true)
    assertEquals(keys.some((k) => k.startsWith('fresh/')), true)
    // A second run has nothing to do, and the space still in its days waits
    // for its own day: the clock is the argument.
    assertEquals(await collected(env), 0)
    assertEquals(await collected(env, new Date(Date.now() + 2 * day)), 0)
    assert((await dir.space('fresh'))?.trashed)
    assert(await dir.space('ada'))
    // An idle test space goes through the same permanent erase, including
    // its app files. Today's writes keep it until seven full days pass.
    await dir.apply({
      entities: [{
        entity: { eid: ADA },
        email: { address: 'probe@bot.yak.sh' },
      }],
    }, by)
    let probe = await makes(dir, 'idle-probe')
    await app(probe, 'notes')
    let after = new Date(Date.now() + 8 * day)
    // Plus spaces have no app limit. The activity read must fit the
    // directory's 100-parameter ceiling, including the last app's writes.
    let many = Array.from({ length: 100 }, (_, i) => ({
      entity: { eid: `probe-app-${i}` },
      app: { space: probe.eid, slug: `app-${i}`, access: 'private' },
    }))
    await meta(env).apply(many, KERNEL)
    await meta(env).apply(
      [{
        entity: { eid: 'last-app-write' },
        grant: { app: 'probe-app-99', person: ADA, access: 'viewer' },
        created: { at: new Date(after.getTime() - day).toISOString(), by: ADA },
      }],
      KERNEL,
      { stamp: false },
    )
    assertEquals(await abandoned(env, after, probe.eid), [])
    await meta(env).apply(
      [{ entity: { eid: 'last-app-write' }, $delete: true }],
      KERNEL,
    )
    assertEquals(await abandoned(env, after, probe.eid), [probe.eid])
    await meta(env).apply(
      many.map(({ entity }) => ({ entity, $delete: true })),
      KERNEL,
    )
    // A recent memory write is use too, without touching the space row.
    await meta(env).apply(
      [{
        entity: { eid: 'recent-memory' },
        memory: { space: probe.eid },
        doc: { title: 'Still in use' },
        created: { at: new Date(after.getTime() - day).toISOString(), by: ADA },
      }],
      KERNEL,
      { stamp: false },
    )
    await collected(env, after)
    assert(await dir.space('idle-probe'))
    await meta(env).apply(
      [{ entity: { eid: 'recent-memory' }, $delete: true }],
      KERNEL,
    )
    await collected(env, after)
    assert((await dir.space('idle-probe'))?.trashed)
    assertEquals(
      (await r2Objects(env.BLOBS).list('idle-probe/')).length,
      1,
    )
  },
)

test('the sweep retains idle test accounts and people', async () => {
  let scenario = platform('a probe secret')
  await using _ = scenario
  let { env } = scenario
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) })
  let bot = 'a0000000-0000-4000-8000-0000000000c1'
  let human = 'a0000000-0000-4000-8000-0000000000c2'
  await dirPart.stamp(env, {
    entities: [
      {
        entity: { eid: bot },
        person: {},
        email: { address: 'gone@bot.yak.sh' },
      },
      {
        entity: { eid: human },
        person: {},
        email: { address: 'kept@example.com' },
      },
    ],
  })
  await collected(env)
  assertEquals(await dir.emailAt(bot), 'gone@bot.yak.sh')
  await collected(env, new Date(Date.now() + 8 * 86_400_000))
  assertEquals(await dir.emailAt(bot), 'gone@bot.yak.sh')
  assertEquals(await dir.emailAt(human), 'kept@example.com')
})

test('the sweep trashes an idle space nobody is seated in', async () => {
  let scenario = platform('a probe secret')
  await using _ = scenario
  let { env } = scenario
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) })
  let space = await makes(dir, 'seatless')
  let seat = (await dir.member(space, ADA))!
  await meta(env).apply([{ entity: { eid: seat.eid }, tombstone: {} }], KERNEL)
  assertEquals(await dir.members(space), [])
  await collected(env)
  assert(await dir.space('seatless'))
  await collected(env, new Date(Date.now() + 8 * day))
  assert((await dir.space('seatless'))?.trashed)
})

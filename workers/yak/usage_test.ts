// Object ids keep usage with one deployment even when another deployment
// holds the same app handle. Both analytics datasets must make that join.
import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import type { ByDay } from '@yaks/ui/chart'
import type { Meter, Space, Tier } from './directory.ts'
import {
  accountOf,
  daysOfAnswer,
  fileSizes,
  full,
  fullFiles,
  measured,
  read,
  sweep,
} from './usage.ts'
import { holding } from './held.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { platform } from './testing.ts'
import { meta } from './meta.ts'
import type { Env } from './env.ts'
import type { Host } from './host.ts'
import {
  atCeiling,
  atStored,
  BUDGET,
  budget,
  BUILDS,
  ceilings,
  count,
  counted,
  countedBuild,
  countedRealtime,
  countedSpend,
  FILES,
  FREE,
  gauged,
  LETTERS,
  level,
  PLUS,
  refusedSpend,
  requestUnits,
  size,
  type Spend,
  spent,
  WARN,
  weighed,
} from './meter.ts'
import { none } from './meter.ts'

let ANSWER = {
  data: {
    viewer: {
      accounts: [{
        durableObjectsInvocationsAdaptiveGroups: [
          {
            dimensions: { objectId: 'jeff/recipe-box' },
            sum: { requests: 93 },
          },
          {
            dimensions: { objectId: 'jeff/recipe-box', type: 'hibernation' },
            sum: { requests: 40 },
          },
          { dimensions: { objectId: 'yak/platform' }, sum: { requests: 2176 } },
          // Not an app of ours: nobody asks for it, and it costs nothing to
          // carry.
          {
            dimensions: { objectId: 'cf-singleton-container' },
            sum: { requests: 72 },
          },
        ],
        durableObjectsPeriodicGroups: [
          {
            dimensions: { objectId: 'jeff/recipe-box' },
            sum: {
              rowsRead: 48358,
              rowsWritten: 1632,
              inboundWebsocketMsgCount: 100,
            },
          },
          {
            dimensions: { objectId: 'yak/platform' },
            sum: { rowsRead: 872425, rowsWritten: 8741 },
          },
        ],
        accountInvocations: [{ sum: { requests: 2240 } }],
        accountWorkers: [{ sum: { requests: 30000, cpuTimeUs: 45_000_000 } }],
        accountPeriodic: [{
          sum: {
            rowsRead: 920783,
            duration: 125,
            inboundWebsocketMsgCount: 11,
          },
        }],
      }],
    },
  },
  errors: null,
}

test('meter queries distinguish the same handle in two deployments', async () => {
  let { env } = platform('meter-staging', {
    CF_ACCOUNT: 'account',
    CF_ANALYTICS_TOKEN: 'read-only',
    WORKER_NAME: 'yak-staging',
  })
  await env.BLOBS.put('ada/recipes/blobs/photo', new Uint8Array(17))
  let stores = env.STORE
  let asked: string[] = []
  env.STORE = {
    idFromName: (name) => `staging:${name}`,
    get: (id) => {
      asked.push(String(id))
      return stores.get(String(id).slice('staging:'.length))
    },
  }
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) })
  await dir.apply({
    entities: [
      {
        entity: { eid: '$space' },
        doc: { title: 'Ada' },
        space: { slug: 'ada', store: 'ada' },
      },
      {
        entity: { eid: '$app' },
        doc: { title: 'Recipes' },
        app: { space: '$space', slug: 'recipes', store: 'ada/recipes' },
      },
    ],
  }, { 'x-yak-role': 'owner' })
  // What the app's own store told the directory after a write (graph.ts
  // `#tell`): the sweep keeps it and adds the space's up from it.
  let recipes = (await dir.app((await dir.space('ada'))!, 'recipes'))!
  await weighed(env, recipes.eid, 4096)
  let was = globalThis.fetch
  globalThis.fetch = ((_to: string | Request, init?: RequestInit) => {
    // The visits, asked of the analytics SQL API beside the bill.
    if (String(init?.body).startsWith('SELECT')) {
      return Promise.resolve(
        Response.json({ data: [{ app: recipes.eid, views: 12 }] }),
      )
    }
    let { query } = JSON.parse(String(init?.body))
    assertEquals(query.match(/dimensions \{ objectId(?: type)? \}/g)?.length, 2)
    let values = (key: string) => [
      {
        dimensions: { objectId: 'production:ada/recipes' },
        sum: { [key]: 900 },
      },
      { dimensions: { objectId: 'staging:ada/recipes' }, sum: { [key]: 7 } },
    ]
    return Promise.resolve(Response.json({
      data: {
        viewer: {
          accounts: [{
            durableObjectsInvocationsAdaptiveGroups: [
              ...values('requests'),
              {
                dimensions: {
                  objectId: 'staging:ada/recipes',
                  type: 'hibernation',
                },
                sum: { requests: 20 },
              },
            ],
            durableObjectsPeriodicGroups: values('rowsRead').map((g) => ({
              ...g,
              sum: {
                ...g.sum,
                inboundWebsocketMsgCount:
                  g.dimensions.objectId.startsWith('staging:') ? 40 : 900,
              },
            })),
            accountInvocations: [{ sum: { requests: 7 } }],
            accountPeriodic: [{ sum: { rowsRead: 7, duration: 1 } }],
          }],
        },
      },
    }))
  }) as typeof fetch
  try {
    asked.length = 0
    let writes = async () =>
      (await meta(env).query('(.space | .app) ?created ?updated'))
        .map(({ entity, created, updated }) => ({
          eid: entity.eid,
          created,
          updated,
        }))
    let before = await writes()
    await sweep(env, new Date('2026-09-07T00:00:00Z'))
    assertEquals(await writes(), before)
    let space = (await dir.space('ada'))!
    let app = (await dir.app(space, 'recipes'))!
    assertEquals(app.meter?.requests, 27)
    assertEquals(app.meter?.ws_hibernated, 20)
    assertEquals(app.meter?.ws_messages, 60)
    assertEquals(requestUnits(app.meter!), 10)
    assertEquals(app.meter?.rows_read, 7)
    assertEquals(app.meter?.bytes, 4096)
    let { apps } = await dir.census()
    assertEquals(
      apps.find((r) => r.entity.eid == recipes.eid)?.meter?.visits,
      12,
    )
    assertEquals(space.meter?.requests, 27)
    assertEquals(space.meter?.ws_hibernated, 20)
    assertEquals(space.meter?.ws_messages, 60)
    assertEquals(space.meter?.bytes, 4096)
    assertEquals(space.meter?.files, 17)
    // The reading asked the app's store nothing: only the directory's own.
    assertEquals(asked.filter((id) => id.includes('ada/')), [])
  } finally {
    globalThis.fetch = was
  }
})

test('an analytics answer reads as one row per store', () => {
  let by = read(ANSWER)
  assertEquals(by.get('jeff/recipe-box'), {
    requests: 133,
    ws_messages: 140,
    ws_hibernated: 40,
    rows_read: 48358,
    rows_written: 1632,
  })
  assertEquals(by.get('yak/platform')?.rows_written, 8741)
  // A store the datasets never named is not zero — it is absent, and the
  // sweep writes zeros for it from its own list of apps.
  assertEquals(by.get('jeff/nothing-yet'), undefined)
})

test('account usage includes the directory and active-socket messages', () => {
  assertEquals(accountOf(ANSWER, new Date('2026-09-28T10:00:00Z')), {
    month: '2026-09',
    at: '2026-09-28T10:00:00.000Z',
    requests: 2251,
    rows_read: 920783,
    duration: 125,
    workers: 30000,
    cpu: 45000,
  })
})

test('a store in one dataset and not the other still reads', () => {
  let by = read({
    data: {
      viewer: {
        accounts: [{
          durableObjectsInvocationsAdaptiveGroups: [
            { dimensions: { objectId: 'jeff/quiet' }, sum: { requests: 4 } },
          ],
          durableObjectsPeriodicGroups: [],
        }],
      },
    },
  })
  assertEquals(by.get('jeff/quiet'), {
    requests: 4,
    ws_messages: 0,
    ws_hibernated: 0,
    rows_read: 0,
    rows_written: 0,
  })
})

test('a token that may not read analytics is a throw, not a zero', () => {
  // The API answers 200 with `errors` for an unauthorized token; metering
  // everyone at zero would quietly say every space is idle.
  assertThrows(
    () => read({ data: null as never, errors: [{ message: 'unauthorized' }] }),
    Error,
    'unauthorized',
  )
})

test('bytes read as a person says them', () => {
  assertEquals(size(0), '0 B')
  assertEquals(size(999), '999 B')
  assertEquals(size(1536), '1.5 KB')
  assertEquals(size(252_706_816), '241 MB')
  assertEquals(size(1024 ** 3), '1 GB')
})

// The ceilings, at the seam every door reads (T-32758).
let NOW = new Date('2026-09-15T12:00:00Z')

let space = (meter: Partial<Meter> = {}, tier: Tier | null = null): Space => ({
  eid: 'e1',
  slug: 'jeff',
  store: 'jeff',
  title: 'Jeff',
  tier,
  plan: null,
  stripe: null,
  fee: 0,
  told: false,
  trashed: null,
  slugs: [],
  tunnel: null,
  meter: {
    month: '2026-09',
    requests: 0,
    rows_read: 0,
    rows_written: 0,
    bytes: 0,
    emails: 0,
    builds: 0,
    models: 0,
    realtime: 0,
    seconds: 0,
    built: 0,
    at: NOW.toISOString(),
    ...meter,
  },
})

test('a space is near a ceiling at 80% and over it at 100%', () => {
  assertEquals(level(space(), 1, NOW), 'ok')
  assertEquals(level(space({ requests: 39_999 }), 1, NOW), 'ok')
  assertEquals(level(space({ requests: 40_000 }), 1, NOW), 'near')
  assertEquals(level(space({ requests: 50_000 }), 1, NOW), 'over')
  assertEquals(level(space({ ws_messages: 800_000 }), 1, NOW), 'near')
  assertEquals(level(space({ ws_messages: 1_000_000 }), 1, NOW), 'over')
  // Any of the four is enough, and the apps are counted, not metered.
  assertEquals(level(space(), 4, NOW), 'near')
  assertEquals(level(space(), 5, NOW), 'over')
  assertEquals(level(space({ emails: 81 }), 1, NOW), 'near')
  assertEquals(level(space({ bytes: FREE.bytes }), 1, NOW), 'over')
  // Paid spaces have their own ceilings.
  assertEquals(level(space({}, 'plus'), 9, NOW), 'ok')
  assertEquals(level(space({ emails: LETTERS.plus }, 'plus'), 9, NOW), 'over')
  // Last month's reading is not this month's usage.
  assertEquals(
    level(space({ month: '2026-08', requests: 60_000 }), 1, NOW),
    'ok',
  )
})

test('twenty WebSocket messages are one request unit', () => {
  assertEquals(requestUnits({ requests: 0, ws_messages: 40 }), 2)
  assertEquals(requestUnits({ requests: 3, ws_messages: 21 }), 5)
  assertEquals(requestUnits({ requests: 5, ws_hibernated: 2 }), 3)
})

test('Plus ceilings are distinct and comped apps/data stay uncapped', () => {
  assertEquals(ceilings(null), FREE)
  assertEquals(ceilings('free'), FREE)
  assertEquals(ceilings('plus'), PLUS)
  assertEquals(PLUS, {
    apps: null,
    requests: 1_000_000,
    bytes: 10 * 1024 ** 3,
    files: 50 * 1024 ** 3,
  })
  assertEquals(LETTERS.plus, 2_500)
  assertEquals(BUILDS.plus, 100)
  for (let tier of [null, 'free', 'plus'] as const) {
    assertEquals(ceilings(tier, 'yourname'), null)
  }
  assertEquals(level(space({}, 'plus'), 10000, NOW), 'ok')
  assertEquals(level(space({ bytes: PLUS.bytes }, 'plus'), 1, NOW), 'over')
  let comped = { ...space({ bytes: PLUS.bytes * 2 }, 'plus'), slug: 'yourname' }
  assertEquals(level(comped, 10000, NOW), 'ok')
  let said = gauged(space({ bytes: PLUS.bytes }, 'plus'), 51, NOW)
  assertStringIncludes(said, '10 GB of 10 GB of app data')
  assertStringIncludes(said, 'at the limit for app data')
  // The Plus plan sets no ceiling on apps, so the line counts none.
  assert(!/ of [\d,]+ apps/.test(said), said)
  assertEquals(JSON.parse(JSON.stringify(PLUS)).apps, null)
  assertStringIncludes(
    refusal(space({}, 'plus'), 'bytes'),
    'plus tier, which is 10 GB',
  )
})

test("a space's month is one line, and names a ceiling only near or at it", () => {
  let line = gauged(
    space({
      requests: 39_000,
      bytes: 700 * 1024 ** 2,
      models: 0.05,
      realtime: 0.01,
    }),
    3,
    NOW,
  )
  for (
    let said of [
      // The hour those figures were read: the meter is an hourly rollup, and
      // a bare number reads as live (C-32869 item 6).
      '(as of 12:00 UTC)',
      '3 of 5 apps',
      '39,000 of 50,000 request units',
      '700 MB of 1 GB of app data',
      '0 of 100 emails',
      '$0.06 of model use and voice ($0.01 of it voice)',
    ]
  ) assertStringIncludes(line, said)
  assert(!line.includes('limit') && !line.includes('\n'), line)
  let near = gauged(space({ requests: 41_000, emails: 100 }), 3, NOW)
  assertStringIncludes(near, 'at or near the limit for request units')
  assertStringIncludes(near, 'emails; plan settings: ')
  assertStringIncludes(near, 'https://yaks.app/manage/billing?space=jeff')
  assertStringIncludes(gauged(space(), 5, NOW), 'at the limit for apps;')
  // A comped space has no app ceiling to be near.
  assert(!gauged({ ...space(), slug: 'yourname' }, 50, NOW).includes('limit'))
  // Before the month's first sweep, what it reads is no reading at all.
  let early = gauged(space({ at: '', emails: 3 }), 1, NOW)
  assertStringIncludes(early, 'request units not read yet')
  assertStringIncludes(early, '3 of 100 emails')
  assert(!early.includes('of 50,000'), early)
})

// Every door's refusal: a stored ceiling's says what the space holds too.
let refusal = (
  s: Space,
  what: 'apps' | 'bytes' | 'files' | Spend,
  env: Host = {},
) =>
  what == 'bytes' || what == 'files'
    ? atStored(s, what, holding(s, []), env)
    : atCeiling(s, what, env)

// A refusal points at the page that describes the plans and never at anything
// that starts a purchase — the agent surface's policy line (C-33033 on
// D-32751), which is why the assertion is on both halves.
test('a refusal names the ceiling and where the plans are written', () => {
  for (let what of ['apps', 'bytes', 'emails'] as const) {
    let said = refusal(space(), what)
    assertStringIncludes(said, 'free tier')
    assertStringIncludes(said, 'https://yaks.app/manage/billing?space=jeff')
    assert(!/checkout|subscribe/i.test(said), said)
  }
  assertStringIncludes(atCeiling(space(), 'apps'), '5 apps')
  // The letters are the one refusal that is not the free tier's alone, and
  // the one that only stops the send (T-33688).
  assertStringIncludes(atCeiling(space(), 'emails'), '100 emails a month')
  assertStringIncludes(atCeiling(space(), 'emails'), 'still arrive')
  assertStringIncludes(
    atCeiling(space({}, 'plus'), 'emails'),
    '2,500 emails a month',
  )
  assert(
    !/checkout/i.test(gauged(space(), 5, NOW)),
    "the month's line names no purchase either",
  )
})

let refusedBuild = (s: Space, now: Date) =>
  refusedSpend(s, 'builds', {}, 0, now)

// The builder's ceiling (T-34241). A build is one app shipped, so the count is
// written once by the loop that finished one (`countedBuild`) and read before
// it starts (`refusedBuild`).

// The directory that count is written to, in memory, holding one space `jeff`
// with the meter given, and that space as the directory has it now.
let counting = async (meter?: Partial<Meter>, vars: Partial<Env> = {}) => {
  let { env } = platform('counting', vars)
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) })
  await dir.apply({
    entities: [{
      entity: { eid: '$space' },
      space: { slug: 'jeff', store: 'jeff' },
      ...(meter ? { meter } : {}),
    }],
  }, { 'x-yak-role': 'owner' })
  let held = async () => (await dir.space('jeff'))!
  // The figures named, as the directory's meter for the space holds them.
  let read = async (...names: (keyof Meter)[]) => {
    let m = (await held()).meter
    return Object.fromEntries(names.map((k) => [k, m?.[k]]))
  }
  return { env, dir, space: await held(), held, read }
}

test('a free space gets five builds each month regardless of lifetime use', async () => {
  for (let builds of [0, 1, 4]) {
    assertEquals(refusedBuild(space({ builds, built: 40 }), NOW), null)
  }
  let c = await counting()
  await countedBuild(c.env, c.space, 0.25, 0, NOW)
  let one = { month: '2026-09', builds: 1, models: 0.25, seconds: 0, built: 1 }
  assertEquals(
    await c.read('month', 'builds', 'models', 'seconds', 'built'),
    one,
  )

  let after = space({ builds: 5, models: 0.25, built: 45 })
  let no = (refusedBuild(after, NOW))!
  assert(no)
  assertStringIncludes(no, 'https://yaks.app/manage/billing?space=jeff')
  assert(!/checkout|subscribe/i.test(no), no)
  assert(refusedBuild(space({ builds: 6 }), NOW))

  // A refusal costs them nothing — not the build, and not the sentence: the
  // count is written by the loop that finished one, and this one never ran.
  assertEquals(spent(after, NOW).builds, 5)
  assertEquals(
    await c.read('month', 'builds', 'models', 'seconds', 'built'),
    one,
  )

  // The monthly allowance resets; the lifetime figure remains available.
  let october = new Date('2026-10-02T00:00:00Z')
  assertEquals(spent(after, october).built, 45)
  assertEquals(spent(after, october).builds, 0)
  assertEquals(refusedBuild(after, october), null)
})

test('a paid space counts its builds down, and the month gives them back', async () => {
  let plus = (builds: number, month = '2026-09') =>
    space({ month, builds, built: 40 }, 'plus')
  assertEquals(refusedBuild(plus(BUILDS.plus - 1), NOW), null)
  let no = (refusedBuild(plus(BUILDS.plus), NOW))!
  assertStringIncludes(no, `${BUILDS.plus} built-in builds a month`)
  assertStringIncludes(no, 'build again on the 1st')
  assertStringIncludes(no, 'https://yaks.app/manage/billing?space=jeff')
  // Last month's builds are not this month's.
  assertEquals(refusedBuild(plus(BUILDS.plus, '2026-08'), NOW), null)

  // What its model cost is the month's, added to what the space's other
  // model calls spent, in dollars, and its container seconds beside them
  // (sandbox.ts, T-34264).
  let c = await counting({
    month: '2026-09',
    builds: 2,
    models: 0.5,
    built: 40,
  })
  await countedBuild(c.env, c.space, 0.25, 12, NOW)
  assertEquals(await c.read('month', 'builds', 'models', 'seconds', 'built'), {
    month: '2026-09',
    builds: 3,
    models: 0.75,
    seconds: 12,
    built: 41,
  })
})

test('the build line warns at 80%, and the line says both numbers', () => {
  assertEquals(
    level(space({ builds: BUILDS.plus * 0.8 - 1, built: 40 }, 'plus'), 1, NOW),
    'ok',
  )
  assertEquals(
    level(space({ builds: BUILDS.plus * 0.8, built: 40 }, 'plus'), 1, NOW),
    'near',
  )
  assertEquals(
    level(space({ builds: BUILDS.plus, built: 40 }, 'plus'), 1, NOW),
    'over',
  )
  assertEquals(level(space({ builds: 3, built: 40 }), 1, NOW), 'ok')
  assertEquals(level(space({ builds: 4, built: 40 }), 1, NOW), 'near')
  assertEquals(level(space({ builds: 5, built: 40 }), 1, NOW), 'over')

  // Build counts are per space; model cost is attributed to this space while
  // each space's models and voice share its budget.
  let said = gauged(space({ builds: 1, models: 0.04, built: 1 }), 2, NOW)
  assertStringIncludes(said, '1 of 5 builds, 0 of 3,600 build seconds')
  assertStringIncludes(said, "$0.04 of model use and voice from jeff's")
  let plus = gauged(
    space({ builds: 4, models: 0.0012, built: 44 }, 'plus'),
    9,
    NOW,
  )
  assertStringIncludes(plus, `4 of ${BUILDS.plus} builds`)
  assertStringIncludes(plus, '$0.0012 of model use and voice')
})

test('Plus byte writes use the 10 GB ceiling as the stores last told it; comped spaces bypass it', async () => {
  let { env } = platform('plus-bytes')
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) })
  await dir.apply({
    entities: [
      { entity: { eid: '$space' }, space: { slug: 'jeff', store: 'jeff' } },
      {
        entity: { eid: '$app' },
        app: { space: '$space', slug: 'notes', store: 'jeff/notes' },
      },
    ],
  }, { 'x-yak-role': 'owner' })
  let jeff = (await dir.space('jeff'))!
  let notes = (await dir.app(jeff, 'notes'))!
  // The space as the last hourly reading left it, on the Plus plan.
  let plus = (bytes: number) => ({
    ...jeff,
    tier: 'plus' as Tier,
    meter: space({ bytes }).meter,
  })
  await weighed(env, notes.eid, PLUS.bytes)
  assertEquals(await full(env, plus(FREE.bytes), 1, NOW), '')
  assertEquals(await full(env, plus(PLUS.bytes), 0, NOW), '')
  assertStringIncludes(
    await full(env, plus(PLUS.bytes), 1, NOW),
    'plus tier, which is 10 GB',
  )
  // Near the ceiling, what the store told since the reading is what counts,
  // and the refusal says which app holds it.
  await weighed(env, notes.eid, PLUS.bytes + 1)
  let said = await full(env, plus(PLUS.bytes * 0.9), 0, NOW)
  assertStringIncludes(said, 'plus tier, which is 10 GB of app data')
  assertStringIncludes(said, 'holds 10 GB (notes 10 GB)')
  assertEquals(
    await full(env, { ...plus(PLUS.bytes), slug: 'yourname' }, PLUS.bytes, NOW),
    '',
  )
})

test('R2 files use every page of the space prefix, not a sibling or shared pins', async () => {
  let { env } = platform('files-pages')
  let calls: (string | undefined)[] = []
  env.BLOBS.list = ({ prefix, cursor }) => {
    assertEquals(prefix, 'jeff/')
    calls.push(cursor)
    let objects = cursor
      ? [{ key: 'jeff/trashed/blobs/photo', size: 30, uploaded: NOW }]
      : [
        { key: 'jeff/a/index.html', size: 10, uploaded: NOW },
        { key: 'jeff/b/blobs/photo', size: 20, uploaded: NOW },
      ]
    return Promise.resolve({
      objects,
      truncated: !cursor,
      cursor: cursor ? undefined : 'next',
    })
  }
  let held = holding(space(), [], await fileSizes(env, space()))
  assertEquals(held.files, 60)
  assertEquals(
    [...held.apps].map(([slug, h]) => [slug, h.files]),
    [['a', 10], ['b', 20], ['trashed', 30]],
  )
  assertEquals(calls, [undefined, 'next'])
})

test('file ceilings use live R2 growth, allow duplicates and shrinking overwrites', async () => {
  let { env } = platform('files-full')
  for (let tier of ['free', 'plus'] as const) {
    let cap = FILES[tier]
    let extra = 0
    env.BLOBS.list = () =>
      Promise.resolve({
        objects: [{
          key: 'jeff/a/existing',
          size: cap - 3 + extra,
          uploaded: NOW,
        }],
        truncated: false,
      })
    let old = space({ files: cap * WARN, month: '2026-08' }, tier)
    assertEquals(
      await fullFiles(env, old, [{ key: 'jeff/b/new', bytes: 3 }]),
      '',
    )
    // The refusal says what the space holds and each app's share of it.
    let said = await fullFiles(env, old, [{ key: 'jeff/b/new', bytes: 4 }])
    assertStringIncludes(said, `${size(cap)} of photos and files`)
    assertStringIncludes(
      said,
      `holds ${size(cap - 3)} (a ${size(cap - 3)})`,
    )
    assertStringIncludes(
      await fullFiles(env, old, [
        { key: 'jeff/b/new', bytes: 2 },
        { key: 'jeff/a/another', bytes: 2 },
      ]),
      'photos and files',
    )
    extra = 10 // Over the allowance after a downgrade: growth stops, removal does not.
    assertEquals(
      await fullFiles(env, old, [{ key: 'jeff/a/existing', bytes: cap + 7 }]),
      '',
    )
    assertEquals(
      await fullFiles(env, old, [{ key: 'jeff/a/existing', bytes: 1 }]),
      '',
    )
    assertStringIncludes(
      await fullFiles(env, { ...old, slug: 'yourname' }, [{
        key: 'yourname/a/new',
        bytes: 1,
      }]),
      'photos and files',
    )
  }
})

test('an upload under the files warning line never waits on a busy bucket', async () => {
  let { env } = platform('files-busy')
  env.BLOBS.list = () => Promise.reject({ code: 10058 })
  for (let tier of ['free', 'plus'] as const) {
    let under = space({ files: FILES[tier] * WARN - 4 }, tier)
    assertEquals(
      await fullFiles(env, under, [{ key: 'jeff/b/new', bytes: 3 }]),
      '',
    )
  }
})

test('R2 accounting sweeps without analytics, follows deletion and survives the month', async () => {
  let { env, files } = platform('files-sweep')
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) })
  await dir.apply({
    entities: [
      {
        entity: { eid: '$space' },
        space: { slug: 'jeff', store: 'jeff' },
        meter: { month: '2026-08', requests: 77, emails: 12 },
      },
      ...['a', 'b'].map((slug) => ({
        entity: { eid: `$${slug}` },
        app: { space: '$space', slug, store: `jeff/${slug}` },
      })),
    ],
  }, { 'x-yak-role': 'owner' })
  files.held.set('jeff/a/photo', new Uint8Array(20))
  files.held.set('jeff/b/blobs/clip', new Uint8Array(5))
  files.held.set('jeff/trash/photo', new Uint8Array(30))
  files.held.set('jeffrey/a/photo', new Uint8Array(100))
  files.held.set('sha/shared', new Uint8Array(100))
  // What the space and each app hold (T-124320), as the reading left them.
  let held = async () => {
    let jeff = (await dir.space('jeff'))!
    let apps = await dir.apps(jeff)
    let h = holding(jeff, apps)
    return [
      h.files,
      ...['a', 'b'].map((slug) =>
        h.apps.get(apps.find((a) => a.slug == slug)!.eid)?.files
      ),
    ]
  }
  let writes = async () =>
    (await meta(env).query('.space.slug=jeff ?created ?updated'))
      .map(({ created, updated }) => ({ created, updated }))
  let before = await writes()
  assert((await sweep(env, NOW)) >= 1)
  assertEquals(await writes(), before)
  let got = (await dir.space('jeff'))!
  assertEquals(await held(), [55, 20, 5])
  assertEquals(got.meter?.month, '2026-08')
  assertEquals(got.meter?.requests, 77)
  assertEquals(spent(got, NOW).files, 55)
  assertEquals(spent(got, NOW).requests, 0)
  await countedBuild(env, got, 0, 0, NOW)
  assertEquals((await dir.space('jeff'))!.meter?.files, 55)
  files.held.delete('jeff/a/photo')
  await sweep(env, NOW)
  assertEquals(await held(), [35, 0, 5])
  assertEquals(level(space({ files: FILES.free * .8 }), 0, NOW), 'near')
  assertEquals(
    level(space({ files: FILES.free, month: '2026-08' }), 0, NOW),
    'over',
  )
  assertStringIncludes(
    gauged(space({ files: FILES.plus }, 'plus'), 0, NOW),
    '50 GB of 50 GB of photos and files',
  )
})

test('a space whose files cannot be listed keeps its figure, and the rest are read', async () => {
  let held = (slug: string, files: number | null) => ({
    space: {
      eid: `$${slug}`,
      slug,
      meter: files == null ? null : { month: '2026-09', files },
    } as Space,
    apps: [] as dirPart.App[],
  })
  let { entities, refused } = await measured(
    [held('jeff', null), held('ada', 70)],
    {
      sizesOf: ({ slug }) =>
        slug == 'ada'
          ? Promise.reject(new Error('list: refused'))
          : Promise.resolve(new Map([['jeff/a/photo', 20]])),
      counts: null,
      month: '2026-09',
      now: NOW,
    },
  )
  assertEquals(
    entities.map((e) => [e.entity.eid, (e.meter as Meter).files]),
    [['$jeff', 20], ['$ada', 70]],
  )
  assertEquals(refused.map((e) => (e as Error).message), ['list: refused'])
})

test('each reading writes a row its days, and a space its apps added up', async () => {
  let app = (eid: string, slug: string) =>
    ({ eid, slug, meter: null }) as unknown as dirPart.App
  let { entities } = await measured(
    [{
      space: { eid: 's', slug: 'ada', meter: null } as Space,
      apps: [app('a', 'one'), app('b', 'two')],
    }],
    {
      sizesOf: () => Promise.resolve(new Map()),
      counts: () => none(),
      daysOf: (_, a): ByDay =>
        a.slug == 'one'
          ? { '2026-09-01': 2 }
          : { '2026-09-01': 1, '2026-09-02': 5 },
      month: '2026-09',
      now: NOW,
    },
  )
  assertEquals(
    entities.map((e) => [e.entity.eid, e.trend]),
    [
      ['a', { requests: { '2026-09-01': 2 } }],
      ['b', { requests: { '2026-09-01': 1, '2026-09-02': 5 } }],
      ['s', { requests: { '2026-09-01': 3, '2026-09-02': 5 } }],
    ],
  )
})

test("the answer's requests by object and day, added across its groups", () => {
  let group = (objectId: string, date: string, requests: number) => ({
    dimensions: { objectId, date },
    sum: { requests },
  })
  assertEquals(
    [...daysOfAnswer({
      data: {
        viewer: {
          accounts: [{
            days: [
              group('x', '2026-09-01', 1),
              group('x', '2026-09-01', 2),
              group('y', '2026-09-02', 4),
            ],
          }],
        },
      },
    })],
    [['x', { '2026-09-01': 3 }], ['y', { '2026-09-02': 4 }]],
  )
})

test('all quota guidance uses space plan settings without promising a Plus upgrade', () => {
  for (
    const what of [
      'apps',
      'bytes',
      'files',
      'emails',
      'builds',
      'models',
    ] as const
  ) {
    const free = refusal(space(), what, { APEX: 'yaks.fyi' })
    assertStringIncludes(free, 'https://yaks.fyi/manage/billing?space=jeff')
    assertStringIncludes(free, 'Compare paid plans')
    assert(!free.includes('checkout'))
    if (what != 'apps') {
      const paid = refusal(space({}, 'plus'), what)
      assertStringIncludes(paid, 'Manage usage and plan settings')
      assert(!paid.includes('Plus lifts'))
      assert(!paid.includes('Compare paid plans'))
    }
  }
})

test("each space answers to its own allowances and budget, never its owner's other spaces", () => {
  let as = (eid: string, meter: Partial<Meter>, tier: Tier | null = null) => ({
    ...space(meter, tier),
    eid,
    slug: eid,
  })
  let a = as('a', { emails: 60, models: 0.125 })
  let b = as('b', { emails: 99, seconds: 3_000 })
  let full = as('full', { emails: 100, builds: 5, models: 0.2 })
  let paid = as('paid', { emails: 900, models: 3 }, 'plus')
  // b has sent 99 of its own 100, whatever a has sent.
  assertEquals(refusedSpend(b, 'emails', {}, 0, NOW), null)
  let no = refusedSpend(full, 'emails', {}, 0, NOW)!
  assert(!no.includes('shared'), no)
  assertStringIncludes(no, 'Putting full on the Plus plan allows more')
  assert(refusedSpend(full, 'builds', {}, 0, NOW))
  // What a build holds uncounted is added to the reading.
  assertEquals(refusedSpend(b, 'seconds', {}, 599, NOW), null)
  assert(refusedSpend(b, 'seconds', {}, 600, NOW))
  assertEquals(budget(a, NOW), { spent: 0.125, limit: 0.2 })
  assertEquals(refusedSpend(a, 'models', {}, 0.0625, NOW), null)
  assert(refusedSpend(a, 'models', {}, 0.075, NOW))
  assert(refusedSpend(full, 'realtime', {}, 0, NOW))
  // The Plus plan space is held to its own plan's figures.
  assert(refusedSpend(paid, 'models', {}, 0.075, NOW))
  assertEquals(refusedSpend(paid, 'emails', {}, 0, NOW), null)
})

test('a conversation that shipped nothing pays for its model and seconds', async () => {
  let c = await counting({
    month: '2026-09',
    models: 0.5,
    seconds: 2,
    built: 3,
  })
  let after = { models: 0.75, seconds: 7, built: 3 }
  await countedSpend(c.env, c.space, 0.25, 5, NOW)
  assertEquals(await c.read('models', 'seconds', 'built'), after)
  await countedSpend(c.env, c.space, 0, 0, NOW)
  assertEquals(await c.read('models', 'seconds', 'built'), after)
})

// The meter is the directory's to add up (meter.ts `spend`): a count that
// lands beside another, or while the hourly sweep is reading, is never
// written over by a total somebody else worked out.
test('spends counted at once all count, and the sweep keeps them', async () => {
  let c = await counting({ month: '2026-08', models: 0.5, emails: 12 }, {
    CF_ACCOUNT: 'account',
    CF_ANALYTICS_TOKEN: 'read-only',
  })
  await Promise.all([
    countedSpend(c.env, c.space, 0.25, 0, NOW),
    countedSpend(c.env, c.space, 0.25, 0, NOW),
    countedRealtime(c.env, c.space, 0.125, NOW),
    counted(c.env, c.space, NOW),
  ])
  let spends = { month: '2026-09', models: 0.5, realtime: 0.125, emails: 1 }
  assertEquals(await c.read('month', 'models', 'realtime', 'emails'), spends)
  // One more lands while the sweep lists the space's files.
  let list = c.env.BLOBS.list.bind(c.env.BLOBS)
  c.env.BLOBS.list = async (o) => {
    c.env.BLOBS.list = list
    await counted(c.env, c.space, NOW)
    return list(o)
  }
  let was = globalThis.fetch
  let groups = {
    durableObjectsInvocationsAdaptiveGroups: [],
    durableObjectsPeriodicGroups: [],
    accountInvocations: [],
    accountPeriodic: [],
  }
  globalThis.fetch = (_to, init) =>
    Promise.resolve(
      Response.json(
        String(init?.body).startsWith('SELECT')
          ? { data: [] }
          : { data: { viewer: { accounts: [groups] } } },
      ),
    )
  try {
    await sweep(c.env, NOW)
  } finally {
    globalThis.fetch = was
  }
  assertEquals(await c.read('month', 'models', 'realtime', 'emails'), {
    ...spends,
    emails: 2,
  })
})

test('a spend lands on its day, and a letter costs no day', async () => {
  let c = await counting()
  await countedBuild(c.env, c.space, 0.25, 0, NOW)
  await countedBuild(c.env, c.space, 0.5, 0, NOW)
  await counted(c.env, c.space, NOW)
  // Read the way the admin's page reads it.
  let { spaces } = await c.dir.census()
  let row = spaces.find((r) => r.space?.slug == 'jeff')
  assertEquals(Object.values(row?.trend?.spend ?? {}), [0.75])
})

test('models and voice spend one space budget, each counted apart', async () => {
  let half = BUDGET.free / 2
  let both = space({ models: half, realtime: half })
  assert(refusedSpend(both, 'models', {}, 0, NOW))
  assert(refusedSpend(both, 'realtime', {}, 0, NOW))
  let voice = space({ realtime: half })
  assertEquals(refusedSpend(voice, 'models', {}, 0, NOW), null)
  let c = await counting({ month: '2026-09', realtime: half })
  await countedRealtime(c.env, c.space, 0.25, NOW)
  assertEquals(await c.read('realtime', 'models'), {
    realtime: half + 0.25,
    models: 0,
  })
})

test('whole counts read in groups of three, signed', () => {
  for (
    let [n, text] of [
      [0, '0'],
      [999, '999'],
      [1000, '1,000'],
      [12_345_678, '12,345,678'],
      [-12_345_678, '-12,345,678'],
      [Number.MAX_SAFE_INTEGER, '9,007,199,254,740,991'],
    ] as [number, string][]
  ) assertEquals(count(n), text)
})

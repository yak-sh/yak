// Object ids keep usage with one deployment even when another deployment
// holds the same app handle. Both analytics datasets must make that join.
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import type { Meter, Space, Tier } from './directory.ts'
import { read, sweep } from './usage.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { platform } from './harness.ts'
import type { Namespace } from './door.ts'
import {
  atCeiling,
  BUILDS,
  countedBuild,
  FREE,
  level,
  refusedBuild,
  size,
  spent,
  standing,
  usedBuilds,
} from './meter.ts'

let ANSWER = {
  data: {
    viewer: {
      accounts: [{
        durableObjectsInvocationsAdaptiveGroups: [
          {
            dimensions: { objectId: 'jeff/recipe-box' },
            sum: { requests: 93 },
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
            sum: { rowsRead: 48358, rowsWritten: 1632 },
          },
          {
            dimensions: { objectId: 'yak/platform' },
            sum: { rowsRead: 872425, rowsWritten: 8741 },
          },
        ],
      }],
    },
  },
  errors: null,
}

Deno.test('meter queries distinguish the same handle in two deployments', async () => {
  let { env } = platform('meter-staging', {
    CF_ACCOUNT: 'account',
    CF_ANALYTICS_TOKEN: 'read-only',
    WORKER_NAME: 'yak-staging',
  })
  let stores = env.STORE
  env.STORE = {
    idFromName: (name) => `staging:${name}`,
    get: (id) => stores.get(String(id).slice('staging:'.length)),
  }
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) }, true)
  await dir.apply({
    entities: [
      {
        entity: { eid: '$space' },
        doc: { title: 'Ada' },
        space: { slug: 'ada' },
      },
      {
        entity: { eid: '$app' },
        doc: { title: 'Recipes' },
        app: { space: '$space', slug: 'recipes', store: 'ada/recipes' },
      },
    ],
  }, { 'x-yak-role': 'owner' })
  let was = globalThis.fetch
  globalThis.fetch = ((_to: string | Request, init?: RequestInit) => {
    let { query } = JSON.parse(String(init?.body))
    assertEquals(query.match(/dimensions \{ objectId \}/g)?.length, 2)
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
            durableObjectsInvocationsAdaptiveGroups: values('requests'),
            durableObjectsPeriodicGroups: values('rowsRead'),
          }],
        },
      },
    }))
  }) as typeof fetch
  try {
    await sweep(env, new Date('2026-09-07T00:00:00Z'))
    let space = (await dir.space('ada'))!
    let app = (await dir.app(space, 'recipes'))!
    assertEquals(app.meter?.requests, 7)
    assertEquals(app.meter?.rows_read, 7)
    assertEquals(space.meter?.requests, 7)
  } finally {
    globalThis.fetch = was
  }
})

Deno.test('an analytics answer reads as one row per store', () => {
  let by = read(ANSWER)
  assertEquals(by.get('jeff/recipe-box'), {
    requests: 93,
    rows_read: 48358,
    rows_written: 1632,
  })
  assertEquals(by.get('yak/platform')?.rows_written, 8741)
  // A store the datasets never named is not zero — it is absent, and the
  // sweep writes zeros for it from its own list of apps.
  assertEquals(by.get('jeff/nothing-yet'), undefined)
})

Deno.test('a store in one dataset and not the other still reads', () => {
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
    rows_read: 0,
    rows_written: 0,
  })
})

Deno.test('a token that may not read analytics is a throw, not a zero', () => {
  // The API answers 200 with `errors` for an unauthorized token; metering
  // everyone at zero would quietly say every space is idle.
  assertThrows(
    () => read({ data: null as never, errors: [{ message: 'unauthorized' }] }),
    Error,
    'unauthorized',
  )
})

Deno.test('bytes read as a person says them', () => {
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
  title: 'Jeff',
  tier,
  plan: null,
  stripe: null,
  fee: 0,
  told: false,
  trashed: null,
  slugs: [],
  meter: {
    month: '2026-09',
    requests: 0,
    rows_read: 0,
    rows_written: 0,
    bytes: 0,
    emails: 0,
    builds: 0,
    tokens: 0,
    seconds: 0,
    built: 0,
    at: NOW.toISOString(),
    ...meter,
  },
})

Deno.test('a space is near a ceiling at 80% and over it at 100%', () => {
  assertEquals(level(space(), 1, NOW), 'ok')
  assertEquals(level(space({ requests: 39_999 }), 1, NOW), 'ok')
  assertEquals(level(space({ requests: 40_000 }), 1, NOW), 'near')
  assertEquals(level(space({ requests: 50_000 }), 1, NOW), 'over')
  // Any of the four is enough, and the apps are counted, not metered.
  assertEquals(level(space(), 4, NOW), 'near')
  assertEquals(level(space(), 5, NOW), 'over')
  assertEquals(level(space({ emails: 81 }), 1, NOW), 'near')
  assertEquals(level(space({ bytes: FREE.bytes }), 1, NOW), 'over')
  // The letters are the one allowance a paid space still has, so a plus space
  // is not simply beyond every line (T-33688).
  assertEquals(level(space({}, 'plus'), 9, NOW), 'ok')
  assertEquals(level(space({ emails: 1_000 }, 'plus'), 9, NOW), 'over')
  // Last month's reading is not this month's usage.
  assertEquals(
    level(space({ month: '2026-08', requests: 60_000 }), 1, NOW),
    'ok',
  )
})

Deno.test('the line says every number against its ceiling', () => {
  let said = standing(
    space({ requests: 41_000, bytes: 900 * 1024 ** 2 }),
    3,
    NOW,
  )
  assertStringIncludes(said, '3 of 5 apps')
  assertStringIncludes(said, '41,000 of 50,000 requests')
  assertStringIncludes(said, '900 MB of 1 GB')
  assertStringIncludes(said, '0 of 100 emails')
  // The hour those figures were read: the meter is an hourly rollup, and a
  // bare number reads as live (C-32869 item 6).
  assertStringIncludes(said, '(as of 12:00 UTC)')
  assertStringIncludes(said, 'Requests are never refused')
})

Deno.test('before the first sweep the line says so, not zero', () => {
  let said = standing(space({ at: '', emails: 3 }), 1, NOW)
  assertStringIncludes(said, '1 of 5 apps')
  assertStringIncludes(said, 'have not been read yet')
  // The letters are counted as they happen rather than swept, so they are a
  // number even here (T-33688).
  assertStringIncludes(said, '3 of 100 emails')
  assert(!said.includes('of 50,000 requests'), 'it claimed a request count')
  assertStringIncludes(said, 'Requests are never refused')
})

// A refusal points at the page that DESCRIBES the plans and never at anything
// that starts a purchase — the agent surface's policy line (C-33033 on
// D-32751), which is why the assertion is on both halves.
Deno.test('a refusal names the ceiling and where the plans are written', () => {
  for (let what of ['apps', 'bytes', 'emails'] as const) {
    let said = atCeiling(space(), what)
    assertStringIncludes(said, 'free tier')
    assertStringIncludes(said, 'https://yaks.app/pricing')
    assert(!/checkout|billing|subscribe|upgrade/i.test(said), said)
  }
  assertStringIncludes(atCeiling(space(), 'apps'), '5 apps')
  // The letters are the one refusal that is not the free tier's alone, and
  // the one that only stops the SEND (T-33688).
  assertStringIncludes(atCeiling(space(), 'emails'), '100 emails a month')
  assertStringIncludes(atCeiling(space(), 'emails'), 'still arrive')
  assertStringIncludes(
    atCeiling(space({}, 'plus'), 'emails'),
    '1,000 emails a month',
  )
  assert(
    !/checkout|billing/i.test(standing(space(), 3)),
    'the standing line names no purchase either',
  )
})

// The builder's ceiling (T-34241). A build is one app SHIPPED, so the count is
// written once by the loop that finished one (`countedBuild`) and read before
// it starts (`refusedBuild`).

// The store that count is written to: what a Durable Object binding is to the
// two lines of meta.ts that reach it, and no more.
type Patch = { entity: { eid: string }; meter: Record<string, number | string> }
let writes = () => {
  let sent: Patch[] = []
  let ns = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (req: Request) => {
        sent.push(...(await req.json() as Patch[]))
        return new Response('[]')
      },
    }),
  }
  return { sent, env: { STORE: ns as unknown as Namespace } }
}

Deno.test('a free space gets five builds each month regardless of lifetime use', async () => {
  for (let builds of [0, 1, 4]) {
    assertEquals(refusedBuild(space({ builds, built: 40 }), NOW), null)
  }
  let { sent, env } = writes()
  await countedBuild(env, space(), { input: 900, output: 100 }, 0, NOW)
  assertEquals(sent[0].meter, {
    month: '2026-09',
    builds: 1,
    tokens: 1_000,
    seconds: 0,
    built: 1,
  })

  let after = space({ builds: 5, tokens: 1_000, built: 45 })
  let no = refusedBuild(after, NOW)!
  assert(no)
  assertStringIncludes(no, 'https://yaks.app/pricing')
  assert(!/checkout|billing|subscribe/i.test(no), no)
  assert(refusedBuild(space({ builds: 6 }), NOW))

  // A refusal costs them nothing — not the build, and not the sentence: the
  // count is written by the loop that FINISHED one, and this one never ran.
  assertEquals(usedBuilds(after, NOW), 5)
  assertEquals(sent.length, 1)

  // The monthly allowance resets; the lifetime figure remains available.
  let october = new Date('2026-10-02T00:00:00Z')
  assertEquals(spent(after, october).built, 45)
  assertEquals(usedBuilds(after, october), 0)
  assertEquals(refusedBuild(after, october), null)
})

Deno.test('a paid space counts its builds down, and the month gives them back', async () => {
  let plus = (builds: number, month = '2026-09') =>
    space({ month, builds, built: 40 }, 'plus')
  assertEquals(refusedBuild(plus(BUILDS.plus - 1), NOW), null)
  let no = refusedBuild(plus(BUILDS.plus), NOW)!
  assertStringIncludes(no, '30 built-in builds this month')
  assertStringIncludes(no, 'build again on the 1st')
  assertStringIncludes(no, 'https://yaks.app/pricing')
  // Last month's thirty are not this month's.
  assertEquals(refusedBuild(plus(BUILDS.plus, '2026-08'), NOW), null)

  // The tokens are the month's, summed both ways, because what they cost is
  // one number or it is a number nobody can add up.
  let { sent, env } = writes()
  await countedBuild(
    env,
    space({ builds: 2, tokens: 5_000, built: 40 }, 'plus'),
    { input: 1_200, output: 300 },
    // And the container seconds ride the same write, because both are derived
    // from one reading of the space (sandbox.ts, T-34264).
    12,
    NOW,
  )
  assertEquals(sent[0].meter, {
    month: '2026-09',
    builds: 3,
    tokens: 6_500,
    seconds: 12,
    built: 41,
  })
})

Deno.test('the build line warns at 80%, and the line says both numbers', () => {
  assertEquals(level(space({ builds: 23, built: 40 }, 'plus'), 1, NOW), 'ok')
  assertEquals(level(space({ builds: 24, built: 40 }, 'plus'), 1, NOW), 'near')
  assertEquals(level(space({ builds: 30, built: 40 }, 'plus'), 1, NOW), 'over')
  assertEquals(level(space({ builds: 3, built: 40 }), 1, NOW), 'ok')
  assertEquals(level(space({ builds: 4, built: 40 }), 1, NOW), 'near')
  assertEquals(level(space({ builds: 5, built: 40 }), 1, NOW), 'over')

  // Both the build allowance and token usage are monthly on either plan.
  let said = standing(space({ builds: 1, tokens: 4_210, built: 1 }), 2, NOW)
  assertStringIncludes(said, '1 of 5 builds a month (4,210 tokens this month)')
  assertStringIncludes(said, 'a build past 5')
  assertStringIncludes(
    standing(space({ builds: 4, tokens: 900, built: 44 }, 'plus'), 9, NOW),
    '4 of 30 builds a month (900 tokens this month)',
  )
})

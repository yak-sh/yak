// The meter's one seam that needs no runtime: an analytics answer read into
// rows by store name (usage.ts `read`). The fixture is a recorded answer,
// trimmed — the shape of
// https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/
// (data.viewer.accounts[0].<dataset>[].dimensions/sum) with the Durable
// Object datasets documented at
// https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/
// and the field names this account's own schema introspects to.
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import type { Meter, Space, Tier } from './directory.ts'
import { read } from './usage.ts'
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
          { dimensions: { name: 'jeff/recipe-box' }, sum: { requests: 93 } },
          { dimensions: { name: 'yak/platform' }, sum: { requests: 2176 } },
          // Not an app of ours: nobody asks for it, and it costs nothing to
          // carry.
          {
            dimensions: { name: 'cf-singleton-container' },
            sum: { requests: 72 },
          },
        ],
        durableObjectsPeriodicGroups: [
          {
            dimensions: { name: 'jeff/recipe-box' },
            sum: { rowsRead: 48358, rowsWritten: 1632 },
          },
          {
            dimensions: { name: 'yak/platform' },
            sum: { rowsRead: 872425, rowsWritten: 8741 },
          },
        ],
      }],
    },
  },
  errors: null,
}

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
            { dimensions: { name: 'jeff/quiet' }, sum: { requests: 4 } },
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
  told: false,
  trashed: null,
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

Deno.test('a free space is built for once, for the life of the space', async () => {
  assertEquals(refusedBuild(space(), NOW), null)
  let { sent, env } = writes()
  await countedBuild(env, space(), { input: 900, output: 100 }, 0, NOW)
  assertEquals(sent[0].meter, {
    month: '2026-09',
    builds: 1,
    tokens: 1_000,
    seconds: 0,
    built: 1,
  })

  // And that is the one: the sentence names the plan, the number, and the
  // page — never a checkout (C-33033) — and leaves them the tools to keep
  // going by hand.
  let after = space({ builds: 1, tokens: 1_000, built: 1 })
  let no = refusedBuild(after, NOW)!
  assertStringIncludes(no, '1 app built for you for the life of the space')
  assertStringIncludes(no, 'app_new and app_files')
  assertStringIncludes(no, 'https://yaks.app/pricing')
  assert(!/checkout|billing|subscribe/i.test(no), no)

  // A refusal costs them nothing — not the build, and not the sentence: the
  // count is written by the loop that FINISHED one, and this one never ran.
  assertEquals(usedBuilds(after, NOW), 1)
  assertEquals(sent.length, 1)

  // The month is not what gave them the build, so the month does not give
  // them another. The lifetime figure rides the month turn (`spent`).
  let october = new Date('2026-10-02T00:00:00Z')
  assertEquals(spent(after, october).built, 1)
  assertEquals(usedBuilds(after, october), 1)
  assert(refusedBuild(after, october), 'a new month is not a new free build')
})

Deno.test('a paid space counts its builds down, and the month gives them back', async () => {
  let plus = (builds: number, month = '2026-09') =>
    space({ month, builds, built: 40 }, 'plus')
  assertEquals(refusedBuild(plus(BUILDS.plus - 1), NOW), null)
  let no = refusedBuild(plus(BUILDS.plus), NOW)!
  assertStringIncludes(no, '30 apps built for you a month')
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
  // A free space has one build, so it has no 80%: it is at nothing, and then
  // it is at the ceiling.
  assertEquals(level(space({ builds: 1, built: 1 }), 1, NOW), 'over')

  // The line says which SPAN each number is against: a free space's build is
  // for its life, a paid space's thirty are the month's, and the tokens are
  // the month's on either plan.
  let said = standing(space({ builds: 1, tokens: 4_210, built: 1 }), 2, NOW)
  assertStringIncludes(said, '1 of 1 builds ever (4,210 tokens this month)')
  assertStringIncludes(said, 'a build past 1')
  assertStringIncludes(
    standing(space({ builds: 4, tokens: 900, built: 44 }, 'plus'), 9, NOW),
    '4 of 30 builds a month (900 tokens this month)',
  )
})

/// <reference lib="deno.ns" />
// What a page view is written down as, and what it is never written down as
// (views.ts, T-34496). The shape is the privacy promise: six blobs, one index,
// no IP, no visitor id, no user-agent string — so it is pinned here rather
// than left to whoever edits the call site next.
// The other half is what is asked of the SQL API (T-34497): every count is
// `sum(_sample_interval)` rather than `count()`, or a busy app under-reports
// by exactly the factor that made it busy — so the queries are pinned too.
import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import type { Env } from './env.ts'
import {
  classed,
  daily,
  NOT_ON,
  perDay,
  point,
  ran,
  referred,
  sqlAt,
  statsOf,
  topCountries,
  topFrom,
  topPages,
} from './views.ts'

Deno.test('classed: an assistant, a crawler, a person, a script', () => {
  // The AI clients read first: almost all of them spell themselves `…Bot`.
  for (
    let ua of [
      'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
      'Mozilla/5.0 AppleWebKit (KHTML, like Gecko); compatible; ChatGPT-User/1.0',
      'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)',
      'Mozilla/5.0 (compatible; PerplexityBot/1.0)',
      'Mozilla/5.0 (compatible; OAI-SearchBot/1.0)',
    ]
  ) assertEquals(classed(ua), 'agent', ua)

  for (
    let ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'curl/8.7.1',
      'python-requests/2.32.3',
      'facebookexternalhit/1.1',
      'Pingdom.com_bot_version_1.4',
    ]
  ) assertEquals(classed(ua), 'bot', ua)

  for (
    let ua of [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
    ]
  ) assertEquals(classed(ua), 'browser', ua)

  // No user-agent at all is a script, never a person: every browser sends one.
  assertEquals(classed(null), 'bot')
  assertEquals(classed(''), 'bot')
})

Deno.test('referred: the host, never the path — and never ourselves', () => {
  assertEquals(
    referred('https://news.example.com/a/story?q=my+search', 'ada.yaks.app'),
    'news.example.com',
  )
  assertEquals(referred('https://ada.yaks.app/recipes/', 'ada.yaks.app'), '')
  assertEquals(referred(null, 'ada.yaks.app'), '')
  assertEquals(referred('not a url', 'ada.yaks.app'), '')
})

let A_VIEW = {
  app: 'a0000000-0000-4000-8000-00000000000a',
  space: 'ada',
  slug: 'cookbook',
  path: '/cookbook/dinner',
  country: 'US',
  from: 'news.example.com',
  client: 'browser',
  status: 200,
}

Deno.test('point: the columns, in the order the queries read them', () => {
  assertEquals(point(A_VIEW), {
    indexes: [A_VIEW.app],
    blobs: [
      'ada',
      'cookbook',
      '/cookbook/dinner',
      'US',
      'news.example.com',
      'browser',
    ],
    doubles: [200],
  })
})

// developers.cloudflare.com/analytics/analytics-engine/limits/: 20 blobs,
// 20 doubles, ONE index of at most 96 bytes, 16 KB of blobs all together. A
// point over any of those is not recorded, and nothing would say so.
Deno.test('point: inside every Analytics Engine limit, even given junk', () => {
  let long = (n: number) => 'x'.repeat(n)
  let p = point({
    ...A_VIEW,
    path: `/${long(20_000)}`,
    from: long(5_000),
    country: long(5_000),
  })
  assertEquals(p.indexes.length, 1)
  assert(
    new TextEncoder().encode(p.indexes[0]).length <= 96,
    'the index is an eid and must fit in 96 bytes',
  )
  assert(p.blobs.length <= 20, 'at most 20 blobs')
  assert(p.doubles.length <= 20, 'at most 20 doubles')
  let bytes = p.blobs.reduce(
    (n, b) => n + new TextEncoder().encode(b).length,
    0,
  )
  assert(bytes <= 16 * 1024, `blobs are ${bytes} bytes, over the 16 KB budget`)
})

// ---- reading it back -------------------------------------------------------

let APP = A_VIEW.app

Deno.test('every query counts sampled rows, never rows', () => {
  for (
    let sql of [
      perDay(APP),
      topPages(APP),
      topFrom(APP),
      topCountries(APP),
    ]
  ) {
    assert(
      sql.includes('sum(_sample_interval)'),
      `a count that is not sampled: ${sql}`,
    )
    assert(!/\bcount\(\)/.test(sql), `a raw count(): ${sql}`)
    assert(sql.includes(`index1 = '${APP}'`), `not scoped to the app: ${sql}`)
    assert(sql.includes('FROM yak_views'), sql)
  }
})

Deno.test('the four queries, in full', () => {
  assertEquals(
    perDay(APP, 7),
    "SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, " +
      'sum(_sample_interval) AS views ' +
      `FROM yak_views WHERE index1 = '${APP}' ` +
      "AND timestamp >= NOW() - INTERVAL '7' DAY GROUP BY day ORDER BY day",
  )
  assertEquals(
    topPages(APP, 30, 3),
    'SELECT blob3 AS path, sum(_sample_interval) AS views ' +
      `FROM yak_views WHERE index1 = '${APP}' ` +
      "AND timestamp >= NOW() - INTERVAL '30' DAY " +
      'GROUP BY path ORDER BY views DESC LIMIT 3',
  )
  // A direct visit refers nothing and an unknown country is not a country, so
  // both lists drop the empty column rather than leading with it.
  assert(topFrom(APP).includes("AND blob5 != ''"), topFrom(APP))
  assert(topCountries(APP).includes("AND blob4 != ''"), topCountries(APP))
  assert(!topPages(APP).includes("blob3 != ''"), 'every view has a path')
})

Deno.test('nothing reaches the SQL text unshaped', () => {
  // There are no bound parameters, so an eid that is not one is refused
  // rather than spliced in.
  assertThrows(() => perDay("' OR 1=1 --"))
  assertThrows(() => perDay('cookbook'))
  // A window is clamped to what Cloudflare still holds, and a junk one is a
  // day rather than a syntax error.
  assert(perDay(APP, 9999).includes("INTERVAL '90' DAY"))
  assert(perDay(APP, -3).includes("INTERVAL '1' DAY"))
  assert(perDay(APP, NaN).includes("INTERVAL '1' DAY"))
  assert(topPages(APP, 30, 1e9).includes('LIMIT 100'))
})

Deno.test("the endpoint is the account's own", () => {
  assertEquals(
    sqlAt({ CF_ACCOUNT: 'acc0unt' } as Env),
    'https://api.cloudflare.com/client/v4/accounts/acc0unt/analytics_engine/sql',
  )
  // A probe aims it somewhere else, the way MAIL_API and STRIPE_API are aimed.
  assertEquals(
    sqlAt(
      { CF_ACCOUNT: 'acc0unt', ANALYTICS_API: 'http://127.0.0.1:9' } as Env,
    ),
    'http://127.0.0.1:9/accounts/acc0unt/analytics_engine/sql',
  )
})

Deno.test('daily: a dense series, gaps and all', () => {
  let now = Date.parse('2026-09-06T11:00:00Z')
  let series = daily(
    // Cloudflare answers a DateTime, and a wide number as a string.
    [
      { day: '2026-09-06 00:00:00', views: '12' },
      { day: '2026-09-04 00:00:00', views: 3 },
    ],
    4,
    now,
  )
  assertEquals(series, [
    { day: '2026-09-03', views: 0 },
    { day: '2026-09-04', views: 3 },
    { day: '2026-09-05', views: 0 },
    { day: '2026-09-06', views: 12 },
  ])
})

// The fake SQL API: what it was asked, and what it answers.
let sql = (
  answer: (q: string) => { status?: number; body: string },
) => {
  let asked: string[] = []
  let real = globalThis.fetch
  globalThis.fetch = ((_to: string | Request, init?: RequestInit) => {
    asked.push(String(init?.body ?? ''))
    let said = answer(asked[asked.length - 1])
    return Promise.resolve(
      new Response(said.body, { status: said.status ?? 200 }),
    )
  }) as typeof fetch
  return { asked, done: () => void (globalThis.fetch = real) }
}

let env = (vars: Partial<Env> = {}) =>
  ({ CF_ACCOUNT: 'acc0unt', ANALYTICS_TOKEN: 'a token', ...vars }) as Env

Deno.test('a dataset nobody has written to is no views, not a failure', async () => {
  let api = sql(() => ({ status: 404, body: 'unknown table yak_views' }))
  try {
    assertEquals(await ran(env(), perDay(APP)), [])
  } finally {
    api.done()
  }
})

Deno.test('a refusal from the SQL API is said, not swallowed', async () => {
  let api = sql(() => ({ status: 400, body: 'syntax error at line 1' }))
  try {
    await assertRejects(() => ran(env(), perDay(APP)), Error, 'analytics 400')
  } finally {
    api.done()
  }
})

Deno.test('with no token there is nothing to ask, and one sentence to say', () => {
  assertEquals(statsOf(env({ ANALYTICS_TOKEN: undefined }), APP), null)
  assertEquals(statsOf(env({ CF_ACCOUNT: undefined }), APP), null)
  assert(NOT_ON.includes('not switched on'))
})

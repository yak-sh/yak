/// <reference lib="deno.ns" />
// What a page view is written down as, and what it is never written down as
// (views.ts, T-34496). The shape is the privacy promise: six blobs, one index,
// no IP, no visitor id, no user-agent string — so it is pinned here rather
// than left to whoever edits the call site next.
import { assert, assertEquals } from '@std/assert'
import { classed, point, referred } from './views.ts'

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

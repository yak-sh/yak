/// <reference lib="deno.ns" />
// Who asked for a page (./visitor.ts): the words a visit is marked with, and
// how a count of them splits into people and bots.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { classed, split, type Visited } from './visitor.ts'

// A request from this user agent, and from this network as Cloudflare reads it.
let asked = (ua: string | null, cf?: Visited['cf']) =>
  Object.assign(
    new Request('https://ada.yaks.app/', {
      headers: ua == null ? {} : { 'user-agent': ua },
    }),
    { cf },
  )

let CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

test('classed: an assistant, a crawler, a person, a script', () => {
  // The AI clients read first: almost all of them spell themselves `…Bot`.
  for (
    let ua of [
      'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
      'Mozilla/5.0 AppleWebKit (KHTML, like Gecko); compatible; ChatGPT-User/1.0',
      'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)',
      'Mozilla/5.0 (compatible; PerplexityBot/1.0)',
      'Mozilla/5.0 (compatible; OAI-SearchBot/1.0)',
    ]
  ) assertEquals(classed(asked(ua)), 'agent', ua)

  for (
    let ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'curl/8.7.1',
      'python-requests/2.32.3',
      'facebookexternalhit/1.1',
      'Pingdom.com_bot_version_1.4',
      'Deno/2.5.6',
      'node',
      'Bun/1.3.1',
      // What the funnel counted as people's until T-2299: scanners and the
      // fleet's own checks, in words a browser uses but not in its shape.
      'Mozilla/5.0 (compatible; CMS-Checker/1.0; +https://example.com)',
      'Mozilla/5.0 (l9scan/2.0.039313e213e26323e2430313; +https://leakix.net)',
      'Hello from Palo Alto Networks, find out more about our scans in ' +
      'https://docs-cortex.paloaltonetworks.com/r/1/Cortex-Xpanse/Scanning-activity',
      'Mozilla/5.0 (compatible)',
      'Mozilla/5.0',
      'Mozilla/5.0 (Macintosh) AppleWebKit Safari',
      'Mozilla/5.0 agent-check',
      'yaks-agent-check/1.0 (T-154822)',
      'site-check',
      'Google-Lens',
      // What only the maintained list (isbot) knows: a browser's shape, a
      // monitor's name.
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like ' +
      'Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like ' +
      'Gecko) Chrome/120.0 Mobile Safari/537.36 Pingdom',
    ]
  ) assertEquals(classed(asked(ua)), 'bot', ua)

  for (
    let ua of [
      CHROME,
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2_1 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/530.0.0.0]',
      'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
    ]
  ) assertEquals(classed(asked(ua)), 'browser', ua)

  // No user-agent at all is a script, never a person: every browser sends one.
  assertEquals(classed(asked(null)), 'bot')
  assertEquals(classed(asked('')), 'bot')
})

test("classed: a browser on an ad network's own network is its crawler", () => {
  let meta = { country: 'SE', asn: 32934, asOrganization: 'Facebook, Inc.' }
  assertEquals(classed(asked(CHROME, meta)), 'bot')
  assertEquals(
    classed(asked(CHROME, { asOrganization: 'Meta Platforms, Inc.' })),
    'bot',
  )
  assertEquals(
    classed(asked(CHROME, { asn: 7922, asOrganization: 'Comcast' })),
    'browser',
  )
  assertEquals(
    classed(asked(CHROME, { asOrganization: 'Metanet AG' })),
    'browser',
  )
})

test('classed: a bot Cloudflare verified is one, whatever it says it is', () => {
  // As AhrefsBot and an assistant's browser arrived at yaks.app (T-4012).
  let verified = (category: string, ua: string) =>
    classed(asked(ua, { verifiedBotCategory: category }))
  assertEquals(
    verified(
      'Search Engine Optimization',
      'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    ),
    'verified',
  )
  assertEquals(verified('AI Assistant', CHROME), 'verified')
  assertEquals(classed(asked(CHROME, { verifiedBotCategory: '' })), 'browser')
})

test('split: people ran their page; every other request is a bot', () => {
  let cases: [Record<string, number>, ReturnType<typeof split>][] = [
    // Three pages of eleven a browser asked for ran.
    [{ person: 3, browser: 11, bot: 4, agent: 1, verified: 2 }, {
      people: 3,
      bots: 13,
      verified: 2,
    }],
    // Before pages said they ran, a browser's request was a person's, and a
    // page that ran then counts nothing more.
    [{ early: 5, none: 2, bot: 1 }, { people: 5, bots: 1, verified: 0 }],
    // A page its app's worker kept ran with no request counted.
    [{ person: 4, browser: 3 }, { people: 4, bots: 0, verified: 0 }],
    [{}, { people: 0, bots: 0, verified: 0 }],
  ]
  for (let [views, said] of cases) assertEquals(split(views), said)
})

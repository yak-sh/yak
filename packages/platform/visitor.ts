/**
 * `@yaks/platform/visitor` — who asked for a page: a person, a likely bot or
 * a bot Cloudflare verified (T-4012). One classification for every count of
 * visits: an app's Who visited, the admin's pages and yaks.app's own funnel.
 *
 * A visit is marked twice, as two data points with nothing joining them:
 *
 * 1. The request, when the page is answered ({@link classed}): `verified`
 *    where Cloudflare names a verified bot's category, `agent` for an AI
 *    assistant naming itself, `bot` for anything else that is plainly not a
 *    person's browser, and `browser` for the rest.
 * 2. The page's own script, once it runs (yaks.app's `seen` door): `person`.
 *    A fetch that never runs the page never says so, and that is most bots,
 *    a scanner that names Chrome among them.
 *
 * So a count is read from both ({@link split}): people are the pages whose
 * script ran, the verified bots are the requests Cloudflare named, and every
 * other request is a likely bot's. Before {@link SINCE}, when no page said it
 * ran, a `browser` request stands for a person, as it always had.
 *
 * Signals there are and are not (T-4012):
 *
 * - Cloudflare's `request.cf.verifiedBotCategory` is set on yaks.app's plan
 *   (Pro): AhrefsBot arrived as `Search Engine Optimization`.
 * - `request.cf.botManagement` arrives, but its score is 99 and `verifiedBot`
 *   false on every request, AhrefsBot's too: Bot Management is Enterprise's,
 *   and its score is not ours to read (the zone's analytics refuse
 *   `botScore`).
 * - The user agent, against `isbot`'s maintained list.
 * - No maintained list of datacenter networks fits a Worker, and the page's
 *   script tells the scrapers that run there apart anyway.
 * - Cookies and request rates would mean keeping who someone is, which a
 *   visit never does.
 *
 * ```ts
 * import { classed, split } from '@yaks/platform/visitor'
 * import { equal } from '@yaks/testing'
 *
 * let asked = (ua: string, cf = {}) =>
 *   classed(Object.assign(new Request('https://x.test/', {
 *     headers: { 'user-agent': ua },
 *   }), { cf }))
 * let chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
 *   '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
 * equal(asked(chrome), 'browser')
 * equal(asked(chrome, { verifiedBotCategory: 'AI Assistant' }), 'verified')
 * equal(asked('Mozilla/5.0 (compatible; AhrefsBot/7.0)'), 'bot')
 * equal(asked('curl/8.5.0'), 'bot')
 * equal(split({ person: 3, browser: 10, bot: 4, verified: 1 }), {
 *   people: 3, bots: 11, verified: 1,
 * })
 * ```
 *
 * @module
 */
import { isbot } from 'isbot'
import { and, eq, type Expr, fn, lit, lt, ne, not, or } from '@yaks/sql/core'

/** A request as the runtime hands it over, with Cloudflare's own facts on
 * it: the client's country, the network (autonomous system) it asked from,
 * and the category of a bot Cloudflare verified. */
export type Visited = Request & {
  cf?: {
    country?: string
    asn?: number
    asOrganization?: string
    verifiedBotCategory?: string
  }
}

/** What a visit's data point says asked, in one word. */
export type Kind =
  | 'person'
  | 'browser'
  | 'verified'
  | 'agent'
  | 'bot'
  | 'test'

// The AI assistants and the answer engines, which are neither a person's
// browser nor an old-fashioned crawler. Tested before `isbot`, which counts
// them as bots, so they are told apart.
let AGENTS =
  /claude|anthropic|gptbot|chatgpt|openai|oai-search|perplexity|gemini|google-extended|cohere|bytespider|amazonbot|meta-externalagent|applebot-extended|ccbot|duckassist|youbot/i

// The shape every browser's user agent has: `Mozilla/5.0`, its platform in
// parentheses, then its engine and the engine's version (Chrome, Edge, Safari
// and every in-app browser say `AppleWebKit/…`, Firefox `Gecko/…`). A scanner
// that borrows a browser's words seldom borrows the shape: `Mozilla/5.0
// (compatible; …)`, `Mozilla/5.0 (l9scan/…; +https://leakix.net)`, a bare
// `Mozilla/5.0`, `Mozilla/5.0 (Macintosh) AppleWebKit Safari` or a greeting.
// Over yaks.app's home page visits from 2026-11-07 to 11-21 every one without
// it that the crawler list let through, 187 of 871, was one Cloudflare rates
// automated, and no request it rates a likely human lacked it (T-2299).
let BROWSER = /^Mozilla\/5\.0 \([^)]+\) (AppleWebKit|Gecko)\/\d/

// Networks whose every request is a machine's, whatever browser it names: an
// ad network fetching and rendering an ad's landing page to review it, minutes
// after the ad is made and before anyone has seen it, says it is Chrome. By
// the autonomous system number Cloudflare reads the address as, and by the
// organisation's name for a number not listed.
let NETWORKS = {
  asns: new Set([
    32934, // Meta (Facebook)
    63293, // Meta (Facebook)
    54115, // Meta (Facebook)
  ]),
  orgs: /^(facebook|meta platforms)\b/i,
}

let crawls = (cf: Visited['cf']) =>
  NETWORKS.asns.has(cf?.asn ?? 0) ||
  NETWORKS.orgs.test(cf?.asOrganization ?? '')

/**
 * What kind of client asked for a page: `verified`, `agent`, `bot` or
 * `browser` — the only thing kept of its user agent and its network. An
 * absent UA, or one without a browser's shape, is a script or a scanner:
 * every browser sends one, and alike. A `browser` is a person's only once
 * its page runs.
 */
export let classed = (req: Request): Kind => {
  let ua = req.headers.get('user-agent')
  let cf = (req as Visited).cf
  return cf?.verifiedBotCategory
    ? 'verified'
    : !ua
    ? 'bot'
    : AGENTS.test(ua)
    ? 'agent'
    : isbot(ua) || !BROWSER.test(ua) || crawls(cf)
    ? 'bot'
    : 'browser'
}

/** Whether a person's browser may have asked. */
export let isPerson = (req: Request) => classed(req) == 'browser'

/** When pages began saying they ran. Before it a `browser` request stands
 * for a person; from it, only a page that ran is one. */
export let SINCE = '2026-11-27 12:00:00'

// Whether a data point was written before pages said they ran.
let before = (timestamp: Expr) => lt(timestamp, fn('toDateTime', lit(SINCE)))

/**
 * A data point's kind for counting, from its word (`client`) and when it was
 * written (`timestamp`), as Analytics Engine SQL: `early` for a browser's
 * request before {@link SINCE}, `none` for a page that ran before it (its
 * request counted already), and otherwise the word itself.
 */
export let kindOf = (client: Expr, timestamp: Expr): Expr =>
  fn(
    'if',
    and(eq(client, lit('browser')), before(timestamp)),
    lit('early'),
    fn(
      'if',
      and(eq(client, lit('person')), before(timestamp)),
      lit('none'),
      client,
    ),
  )

/** The data points that are people's visits, by the same rule. */
export let people = (client: Expr, timestamp: Expr): Expr =>
  or(
    and(eq(client, lit('person')), not(before(timestamp))),
    and(eq(client, lit('browser')), before(timestamp)),
  )

/** The data points that are requests: every visit, people's and bots'
 * alike. */
export let requests = (client: Expr): Expr => ne(client, lit('person'))

/** How many visits were people's, verified bots' and likely bots'. */
export type Split = { people: number; bots: number; verified: number }

// The kinds that are not a likely bot's request.
let NOT_BOTS = new Set([
  'person',
  'early',
  'browser',
  'verified',
  'none',
  'test',
])

/**
 * Views by {@link kindOf}, split: people are the pages that ran and the
 * browsers' requests before {@link SINCE}; verified bots the requests
 * Cloudflare named; likely bots every other request, and a browser's that no
 * page that ran answers for. A page can run with no request counted (a page
 * its app's own worker keeps), so those never go below none.
 */
export let split = (views: Partial<Record<string, number>>): Split => {
  let n = (kind: string) => views[kind] ?? 0
  let bots = Object.entries(views)
    .filter(([kind]) => !NOT_BOTS.has(kind))
    .reduce((sum, [, v]) => sum + (v ?? 0), 0)
  return {
    people: n('person') + n('early'),
    bots: bots + Math.max(0, n('browser') - n('person')),
    verified: n('verified'),
  }
}

/** Every visit a split counts: what a list with bots shown sums. */
export let all = (s: Split) => s.people + s.bots + s.verified

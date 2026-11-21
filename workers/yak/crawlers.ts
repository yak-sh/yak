// What kind of client asked: a person's browser, an AI assistant, or a
// crawler. The funnel counts a person (funnel.ts, view-point.ts), an app's
// visits say which (views.ts), and an ad network is told only of a person
// (arrival.ts `conversionOf`). Nothing here imports anything, so yak-front
// (front/) holds it.

/** A request as the runtime hands it over, with Cloudflare's own facts on it:
 * the client's country and the network (autonomous system) it asked from. */
export type Visited = Request & {
  cf?: { country?: string; asn?: number; asOrganization?: string }
}

// The AI assistants and the answer engines, which are neither a person's
// browser nor an old-fashioned crawler. Tested first, because most of them
// spell themselves `…Bot` and would otherwise land in the line below.
let AGENTS =
  /claude|anthropic|gptbot|chatgpt|openai|oai-search|perplexity|gemini|google-extended|cohere|bytespider|amazonbot|meta-externalagent|applebot-extended|ccbot|duckassist|youbot/i

// Crawlers, monitors, link unfurlers and anything speaking through a library
// or a runtime's own fetch, such as Deno's, which the fleet's CLI signs in by.
let BOTS =
  /bot|spider|crawler|crawl|slurp|curl|wget|python-requests|go-http-client|okhttp|libwww|httpclient|monitor|uptime|headlesschrome|phantomjs|scrapy|feedfetcher|preview|facebookexternalhit|embedly|pingdom|^deno\/|^node$|^bun\/|undici|node-fetch|axios/i

// The shape every browser's user agent has: `Mozilla/5.0`, its platform in
// parentheses, then its engine and the engine's version (Chrome, Edge, Safari
// and every in-app browser say `AppleWebKit/…`, Firefox `Gecko/…`). A scanner
// that borrows a browser's words seldom borrows the shape: `Mozilla/5.0
// (compatible; …)`, `Mozilla/5.0 (l9scan/…; +https://leakix.net)`, a bare
// `Mozilla/5.0`, `Mozilla/5.0 (Macintosh) AppleWebKit Safari` or a greeting.
// Over yaks.app's home page visits from 2026-11-07 to 11-21 every one without
// it that BOTS let through, 187 of 871, was one Cloudflare rates automated,
// and no request it rates a likely human lacked it (T-2299).
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
 * What kind of client asked, in one word: `browser`, `agent` or `bot` — the
 * only thing kept of its user-agent string and its network. An absent UA, or
 * one without a browser's shape, is a script or a scanner rather than a
 * person: every browser sends one, and alike.
 */
export let classed = (req: Request): string => {
  let ua = req.headers.get('user-agent')
  return !ua
    ? 'bot'
    : AGENTS.test(ua)
    ? 'agent'
    : BOTS.test(ua) || !BROWSER.test(ua) || crawls((req as Visited).cf)
    ? 'bot'
    : 'browser'
}

/** Whether a person's browser asked. */
export let isPerson = (req: Request) => classed(req) == 'browser'

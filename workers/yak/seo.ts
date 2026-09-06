// What the apex says about itself to something that is not a person (T-34288):
// `/robots.txt`, `/sitemap.xml`, `/llms.txt` and `/llms-full.txt`. The pages'
// own `<head>` carries the rest — title, description, canonical, Open Graph,
// JSON-LD — because that half belongs with the words it describes; this file is
// the site said as a LIST, which no single page can say.
//
// Owner, 2026-09-05: "can you also ensure we are maximizing SEO for engines and
// agents? i see them searching and getting mostly 'yik yak' app stuff". Two
// audiences, one address: a crawler that indexes and a model that reads. They
// want different files and the same truth, so both are generated from the same
// two lists — `SITE` here and `PAGES` in guide.ts — and neither can go stale
// against the other.
//
// APEX ONLY. A space's hostname is the customer's face and its `robots.txt` is
// its own (route.ts): what a person publishes there is theirs to say. index.ts
// calls `answer` on the apex branch and nowhere else.
import type { Env } from './env.ts'
import { PAGES, uriOf, WHOLE } from './guide.ts'
import { PLATFORM } from './route.ts'

export let SITE_URL = `https://${PLATFORM}`

let at = (path: string) => `${SITE_URL}${path}`

// The connector's face, in one place (T-34415). Owner, 2026-09-05: the
// connector "provides no icon or description". Three things every connector
// form asks for — a name, a line, a square picture — said once and read by
// both audiences: the MCP `initialize` answer hands them to a client that
// reads `serverInfo` (preauth.ts, mcp.ts), and the connect instructions show
// them to a person who has to type them (pages.ts). The shape is MCP's
// `Implementation` — `title`, `description`, `websiteUrl` and `icons`, each
// `{src, mimeType, sizes}` — as of the 2025-11-25 revision, carried forward
// into 2026-07-28.
//
// The description is the site's own line and not a second one written for
// here: it is already the title of the home page and the alt of the share
// card, so a connector saying anything else would be the platform introducing
// itself two ways.
//
// ChatGPT reads none of this. Its connector form takes a name, a description
// and an icon TYPED IN, and OpenAI publishes no manifest a server can answer
// with (developers.openai.com/apps-sdk, read 2026-09-05; the `ai-plugin.json`
// that once did was retired when they moved to MCP). That is precisely why
// the same three things are ON the page beside the URL, ready to copy.
export let CONNECTOR = {
  name: PLATFORM,
  title: PLATFORM,
  description: 'Build an app by asking Claude or ChatGPT.',
  websiteUrl: SITE_URL,
  icons: [
    { src: at('/connector.svg'), mimeType: 'image/svg+xml', sizes: ['any'] },
    {
      src: at('/connector-512.png'),
      mimeType: 'image/png',
      sizes: ['512x512'],
    },
  ],
}

// The apex's public pages, in the order a stranger should meet them. Every one
// is a file in `public/` served at an extensionless path, and this is the list
// the sitemap and `llms.txt` are both built from.
//
// `style-guide.html` is deliberately absent and carries `robots: noindex`
// instead: it is the design reference, public because it costs nothing to be,
// and a search result for it helps nobody. The apps and errors pages are not
// pages at all — they are the MCP widgets' bytes (mcp.ts).
export let SITE = [
  '/',
  '/pricing',
  '/technical',
  '/help',
  '/terms',
  '/privacy',
  '/acceptable-use',
  '/cookies',
]

// And the pages the WORKER draws (gallery.ts, T-34477), which are pages of
// this site in every way but the one: there is no file under `public/` to read
// a title and a line back out of. So both are written here, beside the list
// they belong to, and the page reads them from this constant rather than the
// other way round.
export let GALLERY = {
  path: '/gallery',
  title: 'The gallery — apps made with yaks.app',
  description:
    'Explore apps made with yaks.app. Try one out or make it your own.',
}

export let RENDERED = [GALLERY]

// Every address the sitemap lists: the pages above, the ones the worker draws,
// then the guide — the map and one page per subject, at the same `.md`
// addresses the connector hands an agent (guide.ts). They are markdown rather
// than HTML and they are indexed anyway, which is the point of publishing them
// at a URL.
export let ADDRESSES = [
  ...SITE.map(at),
  ...RENDERED.map((p) => at(p.path)),
  WHOLE,
  ...PAGES.map((p) => uriOf(p.slug)),
]

// The crawlers named one by one. `*` allows everything already, so naming these
// grants nothing extra — it is a STATEMENT, and the several that read a robots
// file for training or retrieval consent (Google-Extended is only that; it
// governs no crawl) have no other place to read it. A named group REPLACES the
// wildcard group for that agent rather than adding to it, so each gets the
// same disallow list rather than a bare `Allow: /` that would quietly open the
// doors below to exactly the agents we most want here.
export let CRAWLERS = [
  'GPTBot',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Google-Extended',
  'Googlebot',
  'Bingbot',
  '*',
]

// What no crawler should spend itself on: the sign-in doors, which answer a
// form to nobody, and the machine doors, which answer JSON to a client that
// authenticated. None of them is a secret — a robots file grants nothing and
// hides nothing — they are simply not pages.
// `/gallery/review` is one of them and the gallery itself is not: the page is
// a list anybody may read, and the door under it answers one signed link out of
// one letter (gallery.ts). It is nobody's secret — a crawler holding no ticket
// is told the link expired — it is simply not a page.
export let CLOSED = ['/login', '/connect', '/mcp', '/api/', '/gallery/review']

export let robots = () =>
  [
    '# yaks.app — build an app by asking Claude or ChatGPT.',
    '# Crawling and reading here is welcome; the guide is at',
    `# ${WHOLE}, and ${at('/llms.txt')} is the short index of it.`,
    '',
    ...CRAWLERS.flatMap((agent) => [
      `User-agent: ${agent}`,
      'Allow: /',
      ...CLOSED.map((path) => `Disallow: ${path}`),
      '',
    ]),
    `Sitemap: ${at('/sitemap.xml')}`,
    '',
  ].join('\n')

// The deploy's own timestamp as a sitemap `lastmod`. Cloudflare mints version
// metadata on every `wrangler deploy` (wrangler.toml `[version_metadata]`), so
// the date a page was last published is a fact the platform already holds and
// nothing has to be maintained by hand. Absent under `wrangler dev` and the
// probes, where the element is simply left off — a sitemap with no `lastmod` is
// valid, and a made-up date is worse than none.
export let deployed = (env: Env) => env.CF_VERSION_METADATA?.timestamp ?? null

let escaped = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export let sitemap = (lastmod: string | null) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...ADDRESSES.map((url) =>
      `  <url><loc>${escaped(url)}</loc>${
        lastmod ? `<lastmod>${escaped(lastmod)}</lastmod>` : ''
      }</url>`
    ),
    '</urlset>',
    '',
  ].join('\n')

// What a page says about itself, read back out of the page (`<title>` and
// `<meta name=description>`). llms.txt wants a label and a sentence per link
// and both are already written down in the HTML, so they are read from there
// rather than kept a second time here, where the two copies would drift.
export let said = (html: string) => {
  // The pages are formatted, so both the title and the attribute below are
  // spread over several lines in the file they are read from.
  let flat = html.replace(/\s+/g, ' ')
  return {
    title: /<title>([^<]*)<\/title>/.exec(flat)?.[1]?.trim() ?? '',
    description: /<meta name="description" content="([^"]*)"/.exec(flat)?.[1]
      ?.trim() ?? '',
  }
}

let fetched = async (env: Env, url: string) => {
  let res = await env.ASSETS.fetch(new Request(url))
  return res.ok ? await res.text() : ''
}

/** The llms.txt convention: what this is, then links with a line on each. */
export let llms = (
  site: { url: string; title: string; description: string }[],
) =>
  [
    '# yaks.app',
    '',
    '> Build an app by asking Claude or ChatGPT. A recipe box, a sign-up sheet,',
    '> a trip planner — your assistant builds it, and yaks.app keeps it online.',
    '> Your app lives at yourname.yaks.app, saves your data, and works in a browser.',
    '',
    'An app is an index.html and the files beside it, served live, with a graph',
    'store behind it and no build step. An assistant connects over MCP at',
    `${at('/mcp')} and makes apps with the tools it finds there.`,
    '',
    '## Pages',
    '',
    ...site.map((p) =>
      `- [${p.title}](${p.url})${p.description ? `: ${p.description}` : ''}`
    ),
    '',
    '## The guide',
    '',
    `- [The guide](${WHOLE}): the map of everything an app can do, briefly.`,
    ...PAGES.map((p) => `- [${p.title}](${uriOf(p.slug)}): ${p.description}`),
    '',
    '## Optional',
    '',
    `- [llms-full.txt](${
      at('/llms-full.txt')
    }): the guide and every page of it,`,
    '  concatenated, in one fetch.',
    '',
  ].join('\n')

// Every guide page after the guide itself, one document. Each part keeps its
// own `# ` heading, so the only thing added is the address it came from — a
// model that wants to link back, or fetch one page fresh, has it.
export let full = (parts: { url: string; text: string }[]) =>
  parts.map((p) => `<!-- ${p.url} -->\n\n${p.text.trim()}\n`).join(
    '\n\n---\n\n',
  )

// The four addresses, answered here. Null for anything else, so index.ts falls
// through to the assets the way it always did.
export let answer = async (
  path: string,
  env: Env,
): Promise<Response | null> => {
  if (path == '/robots.txt') return text(robots())
  if (path == '/sitemap.xml') {
    return text(sitemap(deployed(env)), 'application/xml')
  }
  if (path == '/llms.txt') {
    let pages = await Promise.all(SITE.map(async (path) => ({
      url: at(path),
      ...said(await fetched(env, at(path))),
    })))
    return text(llms([
      ...pages.filter((p) => p.title),
      // The drawn pages say their own title and line (above): there is no file
      // to read them out of, and a page missing from this list is a page a
      // model never learns is there.
      ...RENDERED.map((p) => ({ ...p, url: at(p.path) })),
    ]))
  }
  if (path == '/llms-full.txt') {
    let all = [WHOLE, ...PAGES.map((p) => uriOf(p.slug))]
    let parts = await Promise.all(
      all.map(async (url) => ({ url, text: await fetched(env, url) })),
    )
    return text(full(parts.filter((p) => p.text)))
  }
  return null
}

let text = (body: string, type = 'text/plain') =>
  new Response(body, {
    headers: { 'content-type': `${type}; charset=utf-8` },
  })

// Public-page contracts: shared navigation, valid jumps, documented
// components, plan allowances that agree with the metering code, and the head
// furniture an engine or a model reads — title, description, canonical, Open
// Graph, JSON-LD — against the lists seo.ts builds `/sitemap.xml`,
// `/robots.txt` and `/llms.txt` from (T-34288).
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { BUILDS, CURRENCY, LETTERS, PRICE } from './meter.ts'
import { PAGES, uriOf, WHOLE } from './guide.ts'
import { kernel } from './probe.ts'
import {
  ADDRESSES,
  CLOSED,
  CRAWLERS,
  llms,
  robots,
  said,
  SITE,
  sitemap,
} from './seo.ts'

let read = (name: string) =>
  Deno.readTextFileSync(new URL(`./public/${name}`, import.meta.url))

let pages = [
  'index.html',
  'help.html',
  'technical.html',
  'pricing.html',
  'terms.html',
  'privacy.html',
  'acceptable-use.html',
  'cookies.html',
]

let branded = [...pages, 'style-guide.html']

Deno.test('every page wears the raster yak', () => {
  for (let page of branded) {
    let html = read(page)
    assert(
      html.includes(
        '<link rel="icon" href="favicon-32.png" type="image/png" sizes="32x32" />',
      ),
      `${page} has no PNG favicon`,
    )
    assert(
      html.includes(
        '<link rel="apple-touch-icon" href="apple-touch-icon.png" />',
      ),
      `${page} has no home-screen icon`,
    )
    assert(!html.includes('yak.svg'), `${page} still uses the old drawing`)
  }
})

let png = (name: string, width: number, height: number) => {
  let bytes = Deno.readFileSync(new URL(`./public/${name}`, import.meta.url))
  assertEquals([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  let view = new DataView(bytes.buffer, bytes.byteOffset)
  assertEquals([view.getUint32(16), view.getUint32(20)], [width, height], name)
  assertEquals(bytes[25], 6, `${name} is not RGBA`)
}

Deno.test('the yak exports have their intended transparent sizes', () => {
  // The share card is the one that is not the yak alone: 1200×630 is what
  // every unfurler crops to, and og.svg beside it is what it is drawn from.
  png('og.png', 1200, 630)
  png('yak.png', 768, 743)
  png('favicon-32.png', 32, 32)
  png('apple-touch-icon.png', 180, 180)
  png('icon-192.png', 192, 192)
  png('icon-512.png', 512, 512)
})

// An extensionless link: the assets door serves `terms.html` for `/terms`
// and redirects the other spelling, so the pages link the short one.
let links = (html: string) =>
  [...html.matchAll(/<a href="\/([a-z-]+)">/g)].map((m) => m[1])

Deno.test('every jump names a section on its own page', () => {
  for (let page of branded) {
    let html = read(page)
    let ids = new Set(
      [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]),
    )
    let jumps = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
    if (
      ['index.html', 'help.html', 'technical.html', 'style-guide.html']
        .includes(page)
    ) {
      assert(jumps.length, `${page} has no jump navigation`)
    }
    for (let j of jumps) assert(ids.has(j), `${page}: #${j} names no section`)
  }
})

Deno.test('the style guide demonstrates every shared component', () => {
  let css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '')
    .split('@layer components {')[1].split('@layer sections {')[0]
  let components = new Set(
    [...css.matchAll(/\.([A-Z][\w-]*)/g)].map((m) => m[1]),
  )
  let examples = new Set(
    [...read('style-guide.html').matchAll(/class="([^"]+)"/g)]
      .flatMap((m) => m[1].split(/\s+/)),
  )
  assert(components.size > 0)
  for (let name of components) {
    assert(examples.has(name), `No example of .${name}`)
  }
})

// The nav is the same four places on every page, or it is not a nav: a link
// that appears on one page and not the next is how a visitor loses the thread
// (T-33643). The current page marks itself with aria-current and nothing else,
// so the set of destinations is identical everywhere.
Deno.test('every page carries the same four nav links', () => {
  let want = ['/#how', '/pricing', '/technical', '/login']
  for (let page of branded) {
    let nav = read(page).split('<nav class="Nav"')[1]?.split('</nav>')[0] ?? ''
    assert(nav, `${page} has no nav`)
    assertEquals(
      [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
      want,
      page,
    )
  }
})

// What the pages SELL is what the code holds a space to (T-33688). The two
// allowances live in one place — meter.ts `LETTERS`, which the send door and
// the standing line both read — so a page quoting a number nothing enforces is
// exactly the copy this test exists to prevent: it was pulled once for saying
// "100 emails a month" of a platform that could not send one at all.
let flat = (html: string) => html.replace(/\s+/g, ' ')

Deno.test('the plan pages carry the email allowance the code enforces', () => {
  let free = `${LETTERS.free} emails a month`
  let plus = `${LETTERS.plus.toLocaleString('en-US')} emails a month`
  for (let page of ['index.html', 'pricing.html', 'technical.html']) {
    let html = flat(read(page))
    assert(html.includes(free), `${page} does not say ${free}`)
    assert(html.includes(plus), `${page} does not say ${plus}`)
  }
  // And the one rule that number needs beside it: only the SEND stops, so a
  // letter written to an app is never turned away at the door.
  assert(flat(read('technical.html')).includes('only SENDING stops'))
  assert(flat(read('pricing.html')).includes('Letters written to you always'))
})

// The builder's number, held to the same rule (T-34241): free is one build for
// the LIFE of the space and Plus a number every month, so the pages say each
// in those words and `BUILDS` is the one place either is written down.
Deno.test('the plan pages carry the builds the code enforces', () => {
  let free = `${BUILDS.free} app built for you`
  let plus = `${BUILDS.plus} apps built for you a month`
  for (let page of ['index.html', 'pricing.html', 'technical.html']) {
    let html = flat(read(page))
    assert(html.includes(free), `${page} does not say ${free}`)
    assert(html.includes(plus), `${page} does not say ${plus}`)
  }
  // A build is one app shipped, not one message — the thing a person is most
  // likely to fear when a chat is what spends it.
  assert(flat(read('technical.html')).includes('not per message'))
})

Deno.test('every footer link names a page that is there', () => {
  for (let page of branded) {
    let foot = read(page).split('<footer')[1] ?? ''
    assert(foot, `${page} has no footer`)
    assertEquals(
      links(foot).map((l) => `${l}.html`),
      pages.slice(1),
      page,
    )
  }
})

// ---- what an engine and a model read (T-34288) -----------------------------

// The address a page is served at, and the file it is served from: the assets
// door answers `terms.html` for `/terms`, and the home page for `/`.
let fileAt = (path: string) =>
  path == '/' ? 'index.html' : `${path.slice(1)}.html`

let pathOf = (page: string) =>
  page == 'index.html' ? '/' : `/${page.replace('.html', '')}`

Deno.test('the sitemap and the pages on disk are one list', () => {
  assertEquals(SITE.map(fileAt).sort(), [...pages].sort())
  // The style guide is public and deliberately not in it, so it says noindex
  // for itself rather than being quietly absent.
  assert(!SITE.includes('/style-guide'))
  assertStringIncludes(
    flat(read('style-guide.html')),
    '<meta name="robots" content="noindex, follow" />',
  )
})

Deno.test('every page carries the head an engine reads', () => {
  let titles: string[] = []
  for (let page of branded) {
    let html = read(page)
    let one = flat(html)
    let url = `https://yaks.app${pathOf(page)}`
    let { title, description } = said(html)
    assert(title, `${page} has no title`)
    assert(description, `${page} has no description`)
    titles.push(title)
    assertStringIncludes(one, '<html lang="en">')
    assertStringIncludes(one, `<link rel="canonical" href="${url}" />`)
    assertStringIncludes(one, `<meta property="og:url" content="${url}" />`)
    assertStringIncludes(
      one,
      '<meta property="og:image" content="https://yaks.app/og.png" />',
    )
    assertStringIncludes(
      one,
      '<meta name="twitter:card" content="summary_large_image" />',
    )
    for (let tag of ['og:title', 'og:description', 'og:site_name']) {
      assert(one.includes(`property="${tag}"`), `${page} has no ${tag}`)
    }
    assertEquals(
      (html.match(/<h1[\s>]/g) ?? []).length,
      1,
      `${page} has more than one h1`,
    )
  }
  assertEquals(new Set(titles).size, titles.length, 'two pages share a title')
})

// The home page's own heading is what a search result is built out of, so it
// says the whole thing rather than a verb.
Deno.test('the home page names itself in its first heading', () => {
  let h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(read('index.html'))![1]
  assertStringIncludes(flat(h1), 'yaks.app')
  assertStringIncludes(flat(h1), 'your own address')
})

// The owner's complaint, held to: a search for "yaks" returns Yik Yak, so the
// home page says what this is not — plainly, in the description a result
// shows, and once in the words a visitor reads.
Deno.test('the home page says once that this is not Yik Yak', () => {
  let html = read('index.html')
  assertStringIncludes(said(html).description, 'yaks.app is not Yik Yak')
  let body = flat(html.split('</head>')[1])
  assertEquals(
    (body.match(/yaks\.app is not Yik Yak: it is/g) ?? []).length,
    1,
    'the home page says it twice, or not at all',
  )
  for (let page of branded.filter((p) => p != 'index.html')) {
    assert(!read(page).includes('Yik Yak'), `${page} repeats it`)
  }
})

// Well-formedness by the only definition that matters here: every tag closes,
// in order, and no bare `&` is left in a value. Deno ships no XML parser and a
// sitemap is a flat list, so this is the parse.
let balanced = (xml: string) => {
  let stack: string[] = []
  for (
    let [, close, name, self] of xml.replace(/<\?[\s\S]*?\?>/g, '')
      .matchAll(/<(\/?)([\w:.-]+)[^>]*?(\/?)>/g)
  ) {
    if (self) continue
    if (close) {
      if (stack.pop() != name) return false
    } else stack.push(name)
  }
  return stack.length == 0
}

Deno.test('the sitemap lists every address, and parses', () => {
  let when = '2026-09-05T19:00:00.000Z'
  let xml = sitemap(when)
  assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'))
  assert(balanced(xml), 'the sitemap does not close its tags')
  assert(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml), 'a bare & in the sitemap')
  assertEquals(
    [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
    ADDRESSES,
  )
  assertEquals(
    ADDRESSES,
    [
      ...SITE.map((p) => `https://yaks.app${p}`),
      WHOLE,
      ...PAGES.map((p) => uriOf(p.slug)),
    ],
  )
  assertEquals((xml.match(/<lastmod>/g) ?? []).length, ADDRESSES.length)
  assertStringIncludes(xml, `<lastmod>${when}</lastmod>`)
  // No deploy metadata, no date: a made-up one would be worse than none.
  assert(!sitemap(null).includes('lastmod'))
})

Deno.test('robots names every crawler and points at the sitemap', () => {
  let groups = new Map<string, string[]>()
  let agent = ''
  let sitemaps: string[] = []
  for (let line of robots().split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue
    let [field, ...rest] = line.split(':')
    let value = rest.join(':').trim()
    if (field == 'User-agent') groups.set(agent = value, [])
    else if (field == 'Sitemap') sitemaps.push(value)
    else {
      assert(agent, `a rule before any user-agent: ${line}`)
      groups.get(agent)!.push(`${field}: ${value}`)
    }
  }
  assertEquals([...groups.keys()], CRAWLERS)
  // A named group REPLACES the wildcard for that agent, so each one has to
  // carry the whole rule set rather than a bare allow.
  for (let [named, rules] of groups) {
    assertEquals(
      rules,
      ['Allow: /', ...CLOSED.map((p) => `Disallow: ${p}`)],
      named,
    )
  }
  assertEquals(sitemaps, ['https://yaks.app/sitemap.xml'])
})

Deno.test('llms.txt links every page and every guide page', () => {
  let site = SITE.map((path) => ({
    url: `https://yaks.app${path}`,
    ...said(read(fileAt(path))),
  }))
  let txt = llms(site)
  assert(txt.startsWith('# yaks.app\n'))
  assertStringIncludes(txt, 'not Yik Yak')
  for (let p of site) {
    assertStringIncludes(txt, `- [${p.title}](${p.url}): ${p.description}`)
  }
  assertStringIncludes(txt, `- [The guide](${WHOLE}):`)
  for (let p of PAGES) {
    assertStringIncludes(
      txt,
      `- [${p.title}](${uriOf(p.slug)}): ${p.description}`,
    )
  }
  assertStringIncludes(txt, 'https://yaks.app/llms-full.txt')
})

// deno-lint-ignore no-explicit-any
let ld = (html: string): any[] =>
  [...html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  )]
    .map((m) => JSON.parse(m[1]))

Deno.test('the home page describes itself at the prices the code charges', () => {
  let [doc] = ld(read('index.html'))
  assertEquals(doc['@context'], 'https://schema.org')
  // deno-lint-ignore no-explicit-any
  let nodes: any[] = doc['@graph']
  assertEquals(nodes.map((n) => n['@type']), [
    'WebSite',
    'Organization',
    'SoftwareApplication',
  ])
  let app = nodes.find((n) => n['@type'] == 'SoftwareApplication')
  let offers = Object.fromEntries(
    // deno-lint-ignore no-explicit-any
    app.offers.map((o: any) => [o.name.toLowerCase(), o]),
  )
  assertEquals(Object.keys(offers).sort(), Object.keys(PRICE).sort())
  for (let [tier, price] of Object.entries(PRICE)) {
    assertEquals(offers[tier].price, String(price), tier)
    assertEquals(offers[tier].priceCurrency, CURRENCY, tier)
    assertEquals(offers[tier]['@type'], 'Offer', tier)
  }
  assertEquals(offers.plus.priceSpecification.price, String(PRICE.plus))
  assertEquals(offers.plus.priceSpecification.valueAddedTaxIncluded, true)
})

Deno.test('the plan pages quote the price the offer names', () => {
  for (let page of ['index.html', 'pricing.html']) {
    assertStringIncludes(flat(read(page)), `$${PRICE.plus} a month`)
  }
})

Deno.test('the help page answers its own questions in JSON-LD', () => {
  let html = read('help.html')
  let [faq] = ld(html)
  assertEquals(faq['@type'], 'FAQPage')
  let headings = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) =>
    m[1].trim()
  )
  assert(headings.length > 0)
  // deno-lint-ignore no-explicit-any
  let asked = faq.mainEntity.map((q: any) => {
    assertEquals(q['@type'], 'Question')
    assertEquals(q.acceptedAnswer['@type'], 'Answer')
    assert(q.acceptedAnswer.text.length > 40, `${q.name} answers nothing`)
    return q.name
  })
  assertEquals(asked, headings)
})

// The four addresses, in workerd, at the apex and NOT on a space's hostname —
// where robots.txt is the customer's own file (route.ts) and always has been.
slow('the apex answers the crawler and the model', async () => {
  let k = await kernel()
  try {
    let robots = await k.at('yaks.app', '/robots.txt')
    assertEquals(robots.status, 200)
    assertEquals(
      robots.headers.get('content-type'),
      'text/plain; charset=utf-8',
    )
    let text = await robots.text()
    assertStringIncludes(text, 'User-agent: ClaudeBot')
    assertStringIncludes(text, 'Sitemap: https://yaks.app/sitemap.xml')

    let map = await k.at('yaks.app', '/sitemap.xml')
    assertEquals(map.status, 200)
    assertStringIncludes(
      map.headers.get('content-type') ?? '',
      'application/xml',
    )
    let xml = await map.text()
    for (let url of ADDRESSES) assertStringIncludes(xml, `<loc>${url}</loc>`)

    // The index, and the whole guide in one fetch — both read the guide's
    // files back through the assets binding, so this proves the addresses are
    // the ones that serve.
    let index = await (await k.at('yaks.app', '/llms.txt')).text()
    assertStringIncludes(index, `- [The guide](${WHOLE}):`)
    for (let p of PAGES) assertStringIncludes(index, uriOf(p.slug))

    let whole = await (await k.at('yaks.app', '/llms-full.txt')).text()
    assertStringIncludes(whole, '# Building an app on yaks.app')
    // And it says the name outright, once, at the top (T-34302).
    assertStringIncludes(whole, 'This place is called yaks.app')
    for (let p of PAGES) {
      assertStringIncludes(whole, `<!-- ${uriOf(p.slug)} -->`)
    }

    // A space with no app of that name has nothing to serve there, and the
    // apex's file is not borrowed for it.
    let theirs = await k.at('jeff.yaks.app', '/robots.txt')
    assert(!(await theirs.text()).includes('Sitemap: https://yaks.app'))
  } finally {
    await k.stop()
  }
})

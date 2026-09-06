// Public-page contracts: shared navigation, valid jumps, documented
// components, plan allowances that agree with the metering code, and the head
// furniture an engine or a model reads — title, description, canonical, Open
// Graph, JSON-LD — against the lists seo.ts builds `/sitemap.xml`,
// `/robots.txt` and `/llms.txt` from (T-34288).
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { REPLY_TO } from './mail.ts'
import { BUILDS, CURRENCY, LETTERS, PRICE } from './meter.ts'
import { PAGES, uriOf, WHOLE } from './guide.ts'
import { connect, spaceIndex } from './pages.ts'
import { kernel } from './probe.ts'
import {
  ADDRESSES,
  CLOSED,
  CONNECTOR,
  CRAWLERS,
  llms,
  robots,
  said,
  SITE,
  SITE_URL,
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

// Color type 6 is RGBA and 2 is opaque truecolor: an icon meant to sit on a
// page carries its own ground, and one meant for a home screen carries none.
let png = (name: string, width: number, height: number, kind = 6) => {
  let bytes = Deno.readFileSync(new URL(`./public/${name}`, import.meta.url))
  assertEquals([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  let view = new DataView(bytes.buffer, bytes.byteOffset)
  assertEquals([view.getUint32(16), view.getUint32(20)], [width, height], name)
  assertEquals(bytes[25], kind, `${name} has the wrong color type`)
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

// The connector's own square (T-34415): the picture a connector form takes and
// the one `serverInfo.icons` names. Both addresses in CONNECTOR are files that
// exist, and the SVG carries its own bytes — an `<img>` loads nothing a
// referenced SVG points at, so an external `href` here would render an empty
// tile in every client that reads it.
Deno.test('the connector icon is square, self-contained and on the ground', () => {
  png('connector-512.png', 512, 512, 2)
  let svg = read('connector.svg').replace(/<!--[^]*?-->/g, '')
  assertStringIncludes(svg, 'viewBox="0 0 512 512"')
  for (let el of svg.matchAll(/<image[^>]*>/g)) {
    assertStringIncludes(el[0], 'href="data:image/png;base64,')
    assertEquals(/href="(?!data:)/.test(el[0]), false)
  }
  for (let icon of CONNECTOR.icons) {
    let file = new URL(
      `./public/${icon.src.slice(SITE_URL.length + 1)}`,
      import.meta.url,
    )
    assert(Deno.statSync(file).size > 0, `${icon.src} is not a file in public/`)
  }
  assertEquals(CONNECTOR.icons.map((i) => i.sizes), [['any'], ['512x512']])
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

// What the plan line MEANS, said in words beside it (T-34242). "1 app built
// for you" is a number; the door it names is a person with no assistant at all
// saying what they want on their own space page, and both pages that quote the
// number say so.
Deno.test('the plan pages say what a build for you is', () => {
  for (let page of ['index.html', 'pricing.html']) {
    let html = flat(read(page)).toLowerCase()
    assert(
      html.includes('your first app, built for you'),
      `${page} does not offer the first build`,
    )
    assert(
      html.includes('without an assistant') || html.includes('no assistant'),
      `${page} does not say the builder needs no assistant`,
    )
  }
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

// The way in is sign-in, everywhere (T-34408). Attaching an assistant is the
// SECOND step and its instructions live on the space a sign-in lands on, so no
// public page hands a stranger `/connect` — and the home page's doors and copy
// say the order: email, a code, your own space, connect your assistant there.
Deno.test('every public page hands a stranger sign-in, never /connect', () => {
  for (let page of branded) {
    let body = read(page).split('</head>')[1] ?? ''
    assert(!body.includes('href="/connect"'), `${page} points at /connect`)
  }
  let html = read('index.html')
  let doors = [...html.matchAll(/<a class="Button" href="([^"]+)"/g)]
    .map((m) => m[1])
  assertEquals(doors, ['/login', '/login'], 'a home-page door misses sign-in')
  let how = flat(html.split('id="how"')[1].split('</section>')[0])
  assertStringIncludes(how, 'Sign in with your email')
  assertStringIncludes(how, 'six-digit code')
  assertStringIncludes(how, 'Connect your assistant')
  assert(
    how.indexOf('Sign in with your email') <
      how.indexOf('Connect your assistant'),
    'the home page still connects before it signs in',
  )
  let join = flat(html.split('id="join"')[1].split('</section>')[0])
  assertStringIncludes(join, 'land on your own space')
  assertStringIncludes(join, 'Connect your assistant there')
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

// The terms are the document a reviewer opens to check what the pricing page
// claims, so they must not carry a second copy of the number: it said the
// place "costs nothing" for two days after checkout shipped (T-34355). No
// figure at all on that page, and a link to the one that has it.
Deno.test('the terms leave every price to the pricing page', () => {
  let html = flat(read('terms.html'))
  assert(!/\$\s?\d/.test(html), 'the terms quote a price of their own')
  assertStringIncludes(html, '<a href="/pricing">pricing page</a>')
  // And the section that would carry one says no number and no "free" of its
  // own: what it costs is a question the pricing page answers.
  let costs = flat(
    read('terms.html').split('<h2>What it costs</h2>')[1].split(
      '</section>',
    )[0],
  )
  assert(!/\d/.test(costs.replace('20 MB', '')), `a figure in: ${costs}`)
  assert(!/\bnothing\b/i.test(costs), 'the terms still say it costs nothing')
  assertStringIncludes(costs, '/pricing')
})

// "This page is the whole list", so everything the code sends off this box is
// named on it (T-34352). Each line below is one recipient in the code, and the
// address is read out of mail.ts rather than typed here.
Deno.test('the privacy policy names everywhere the code sends something', () => {
  let html = flat(read('privacy.html')).toLowerCase()
  // The feedback tool's letter: the words, who sent them, and where it goes
  // (tools.ts `feedback` → mail.ts REPLY_TO and GRAPH).
  assertStringIncludes(html, 'feedback you send us')
  assertStringIncludes(html, REPLY_TO)
  // An app's own address, out and in (post.ts, inbox.ts).
  assertStringIncludes(html, '@yaks.app</b>')
  // The model that reads what a person types to the builder (builder.ts), and
  // the container a build compiles in (sandbox.ts).
  assertStringIncludes(html, 'what you say to our builder')
  assertStringIncludes(html, 'sandbox')
  // Stripe, who sell the plan and hold the card (billing.ts).
  assertStringIncludes(html, 'stripe')
  // And the claim that makes the rest of it a promise.
  assertStringIncludes(html, 'this page is the whole list')
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

// The connect instructions, as they are served. One tab per agent, the URL on
// the clipboard as step one of every one of them, and the three things a
// connector form asks for above them all (T-34412, T-34413, T-34415).
let tabs = ['Claude', 'ChatGPT', 'Claude Code', 'Cursor', 'Any MCP client']

let count = (html: string, s: string) => html.split(s).length - 1

// `/connect` is a signed-in page (T-34408), so it always has a space to say
// something about; none of what is asserted below depends on which.
let page = () =>
  connect({
    slug: 'dana',
    fixed: false,
    plan: { plus: false, ends: '', known: false },
  }).text()

Deno.test('the connect page teaches one agent at a time', async () => {
  let html = await page()
  assertEquals(
    [...html.matchAll(/<label class="Tabs_Tab" for="tab-[a-z-]+">([^<]+)</g)]
      .map((m) => m[1]),
    tabs,
  )
  // The first tab is chosen in the markup, so the panels switch with no script
  // at all — the radios do it, and the script only remembers which.
  assertStringIncludes(
    html,
    '<input type="radio" name="agent" id="tab-claude" value="claude" checked>',
  )
  assertEquals(count(html, '<section class="Card Tabs_Panel'), tabs.length)
  // Step one, everywhere: the URL in the page's one copy control (`copyable`,
  // T-34420) — selectable text so it works with no script, beside a button
  // that stays hidden until the script un-hides it. The words are written once,
  // in the span the button reads, never in an attribute of its own.
  assertEquals(count(html, '<li>Copy the URL:<span class="Copy">'), tabs.length)
  // Four tabs and the card above them get the plain address; ChatGPT gets the
  // longer one it needs (T-34416), and step one is where it is handed over.
  assertEquals(
    count(html, '<span class="Pick">https://yaks.app/mcp</span>'),
    tabs.length,
  )
  assertStringIncludes(
    html,
    '<span class="Pick">https://yaks.app/mcp?auth=required</span>',
  )
  assertEquals(count(html, 'hidden>Copy</button>'), tabs.length + 3)
  assertStringIncludes(
    html,
    'await navigator.clipboard.writeText(said.textContent)',
  )
  // Step two is the way out to that agent's own form, so nobody comes back for
  // the URL: every tab names where it is added.
  for (
    let out of [
      'https://claude.ai/customize/connectors',
      'https://chatgpt.com/plugins',
      'claude mcp add --transport http yaks https://yaks.app/mcp',
      '~/.cursor/mcp.json',
    ]
  ) assertStringIncludes(html, out)
  // And the OAuth line is a marked placeholder in each tab, not written copy.
  assertEquals(count(html, 'class="Note Soon"'), tabs.length)
})

Deno.test('the connect page shows the connector its own face', async () => {
  let html = await page()
  assertStringIncludes(
    html,
    `<img class="Face_Icon" src="${SITE_URL}/connector.svg"`,
  )
  assertStringIncludes(html, `<a href="${SITE_URL}/connector-512.png">`)
  assertEquals(
    CONNECTOR.description,
    'Apps your assistant builds for you, at your own address.',
  )
  assertStringIncludes(
    html,
    '<span class="Pick">Apps your assistant builds for you, at your own address.</span>',
  )
  assertStringIncludes(html, '<span class="Pick">yaks.app</span>')
})

// One source, two places: a space's owner block is the same instructions, so a
// tab added here is a tab there (pages.ts `doors`).
Deno.test('the space page owner block carries the same instructions', async () => {
  let html = await (await spaceIndex({
    space: 'dana',
    title: 'Dana',
    apps: [],
    hidden: 0,
    role: 'owner',
    person: true,
    signIn: 'https://yaks.app/login',
    connected: false,
  })).text()
  assertStringIncludes(html, '<details class="Attach" open>')
  for (let tab of tabs) assertStringIncludes(html, `>${tab}</label>`)
  assertEquals(
    count(html, '<li>Copy the URL:<span class="Copy">'),
    tabs.length,
  )
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

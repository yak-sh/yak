// The documentation pages (docs.ts, T-37752): the guide's own markdown drawn
// as pages of this site. What can rot here is the join between the two —
// a subject offered in the contents with no markdown behind it, a page whose
// heading never reaches its title, a guide link that still lands on a file a
// browser downloads — so each is asserted against the files themselves.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { headings, parse } from '@yaks/markdown'
import { front } from '@yaks/yaml'
import { parseHTML } from 'linkedom'
import { AGENT, answer, CONTENTS, DOCS, PATH, pathOf } from './docs.ts'
import { claudeAdd } from './signin-pages.ts'
import type { Env } from './env.ts'
import { PAGES } from './guide.ts'
import { esc } from './html.ts'
import { KEEP } from './versions.ts'

// The assets binding, answering out of public/ the way it does in the Worker.
let site = () =>
  ({
    ASSETS: {
      fetch: async (req: Request) => {
        let at = new URL(
          `./public${new URL(req.url).pathname}`,
          import.meta.url,
        )
        try {
          return new Response(await Deno.readTextFile(at))
        } catch {
          return new Response('', { status: 404 })
        }
      },
    },
  }) as unknown as Env

let got = async (path: string) => {
  let said = await answer(new Request(`https://yaks.app${path}`), site(), path)
  assert(said, `nothing answered ${path}`)
  return said
}

let read = async (path: string) => (await got(path)).text()

test('/docs draws the guide with a link to every page', async () => {
  let html = await read('/docs')
  assertStringIncludes(html, `<title>${esc(DOCS.title)}</title>`)
  assertStringIncludes(
    html,
    '<link rel="canonical" href="https://yaks.app/docs">',
  )
  // The guide's own heading, drawn rather than written here, and only one.
  // It wears the anchor the renderer names it by, like every heading here.
  assertStringIncludes(
    html,
    '<h1 id="building-a-yaks-app">Building a yaks app</h1>',
  )
  assertEquals((html.match(/<h1[\s>]/g) ?? []).length, 1)
  for (let p of CONTENTS) {
    assertStringIncludes(
      html,
      `<a href="${pathOf(p.slug)}">${esc(p.title)}</a>`,
    )
  }
  // The technical page is one of them, and the one rule is said at the foot
  // for the reader who wants the file rather than the page.
  assertStringIncludes(html, '<a href="/docs/technical">Technical Details</a>')
  assertStringIncludes(html, '<a href="/docs.md">/docs.md</a>')
  // A guide page is linked at the page beside this one, never at its .md.
  assertStringIncludes(html, 'href="/docs/querying"')
  assertEquals(html.includes('https://yaks.app/docs/querying.md'), false)
})

// A page is titled by the heading it opens with, which is the page's own name
// for itself and the same words as the title it is filed under.
let heading = (slug: string) =>
  /^# (.+)$/m.exec(
    Deno.readTextFileSync(
      new URL(`./public/docs/${slug}.md`, import.meta.url),
    ),
  )![1]

test('every guide page draws under its own heading', async () => {
  for (let p of CONTENTS) {
    let html = await read(pathOf(p.slug))
    let name = heading(p.slug)
    assertStringIncludes(html, `<title>${esc(name)} · yaks.app</title>`)
    assertStringIncludes(html, `content="${esc(p.description)}"`)
    assertEquals((html.match(/<h1[\s>]/g) ?? []).length, 1, p.slug)
    // The document itself, not its frontmatter: the heading opens the
    // article, which is what the sidebar and the contents list sit beside.
    assertStringIncludes(
      html.split('<article')[1].slice(0, 160),
      `>${esc(name)}</h1>`,
    )
    assertStringIncludes(html, '<a href="/docs">← Documentation</a>')
    assertStringIncludes(html, '<nav class="Nav"')
  }
})

// The sidebar is the whole documentation, on every page of it, with the page
// being read marked — a list that goes stale the day a page is added is the
// thing this asserts against CONTENTS itself.
// The side's links, and the one marked as the page being read: read from
// what stands before the document, since a whole page is slow to parse.
let sidebar = (html: string) => {
  let side = html.slice(html.indexOf('<main'), html.indexOf('<article'))
  let nav = parseHTML(side).document.querySelector(
    'nav.Page_Side[aria-label="Documentation"]',
  )
  let hrefs = (q: string) =>
    [...nav?.querySelectorAll(q) ?? []].map((a) => a.getAttribute('href'))
  return { links: hrefs('a'), current: hrefs('a[aria-current="page"]') }
}

test('every page of the documentation carries the whole list beside it', async () => {
  for (let at of [PATH, ...CONTENTS.map((p) => pathOf(p.slug))]) {
    let nav = sidebar(await read(at))
    assertEquals(nav.links, [PATH, ...CONTENTS.map((p) => pathOf(p.slug))], at)
    // Exactly one entry is the page being read, and it is this one.
    assertEquals(nav.current, [at], at)
  }
})

// What is on the page, linked by the ids the renderer gave those very
// headings (@yaks/markdown). A contents list whose links land nowhere is
// worse than none, so both halves are asserted against the same file.
let fileAt = (path: string) =>
  Deno.readTextFileSync(new URL(`./public${path}`, import.meta.url))

let sourceOf = (path: string) => front(fileAt(path), path).body

test('a page lists its own sections, and every one of them is there', async () => {
  for (let p of CONTENTS) {
    let html = await read(pathOf(p.slug))
    let toc = html.split('<nav class="Page_Aside')[1].split('</nav>')[0]
    let inside = headings(parse(sourceOf(`/docs/${p.slug}.md`)))
      .filter((v) => v.depth == 2 || v.depth == 3)
    assert(inside.length > 1, p.slug)
    assertEquals(
      [...toc.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]),
      inside.map((v) => v.id),
      p.slug,
    )
    // And the headings themselves wear those ids.
    for (let v of inside) {
      assertStringIncludes(html, `<h${v.depth} id="${v.id}">`)
    }
  }
})

// The technical page is drawn from its own markdown like every other page,
// and it is the page the guide does not offer: no `guide` row in the file, no
// row in PAGES, and the words still reach the page.
test('the technical page is markdown drawn like the rest', async () => {
  assertEquals(PAGES.find((p) => p.slug == 'technical'), undefined)
  assertEquals(
    front(fileAt('/docs/technical.md'), 'technical.md').meta.guide,
    undefined,
  )
  let html = await read(pathOf('technical'))
  assertStringIncludes(html, '<title>Technical Details · yaks.app</title>')
  assertEquals(sidebar(html).current, [pathOf('technical')])
  // The frame's width is asked for on the body, and the document is the
  // article inside it (T-37785).
  assertStringIncludes(html, '<body class="Docs">')
  assertStringIncludes(html, '<main class="Page">')
  assertStringIncludes(html, '<article class="Page_Body Prose">')
  assertEquals((html.match(/<main[\s>]/g) ?? []).length, 1)
  assertEquals((html.match(/<h1[\s>]/g) ?? []).length, 1)
  // A number read off the code is on the page.
  assertStringIncludes(html, `${KEEP} versions`)
})

// The whole rule, on one page: the `.md` address is the file, the address
// without it is that same file drawn, and neither redirects to the other.
test('a page and its markdown are one text at two addresses', async () => {
  for (let at of [PATH, ...CONTENTS.map((p) => pathOf(p.slug))]) {
    let text = sourceOf(`${at}.md`)
    // Nothing is drawn for the `.md` address: it is a file under public/.
    assertEquals(
      await answer(
        new Request(`https://yaks.app${at}.md`),
        site(),
        `${at}.md`,
      ),
      null,
      at,
    )
    // And the page is that file's own words, heading and all.
    let html = await read(at)
    let lead = /^# (.+)$/m.exec(text)![1]
    assertStringIncludes(html, `>${esc(lead)}</h1>`, at)
  }
})

// Every address these moved from answers a 301 rather than a 404: the links
// are in the world and in the resource list a connector cached (T-37793).
test('the addresses the documentation moved from redirect to it', async () => {
  for (
    let [was, now] of [
      ['/technical', '/docs/technical'],
      ['/guide.md', '/docs.md'],
      ['/guide/querying.md', '/docs/querying.md'],
      ['/guide/nope.md', '/docs/nope.md'],
    ]
  ) {
    let said = await got(was)
    assertEquals(said.status, 301, was)
    assertEquals(said.headers.get('location'), `https://yaks.app${now}`, was)
  }
})

// A moved address keeps its query, so a shared link's `ref` arrives too.
test('a documentation move keeps the query', async () => {
  for (
    let [was, now] of [
      ['/technical', '/docs/technical'],
      ['/guide/querying.md', '/docs/querying.md'],
    ]
  ) {
    let req = new Request(`https://yaks.app${was}?ref=hn`)
    let said = await answer(req, site(), was)
    assertEquals(said!.headers.get('location'), `https://yaks.app${now}?ref=hn`)
  }
})

// The link a person pastes into their agent (T-135903): a browser gets the
// page, an agent's fetch gets the markdown, and both are public/agent.md.
let asked = async (accept: string) => {
  let said = await answer(
    new Request(`https://yaks.app${AGENT.path}`, { headers: { accept } }),
    site(),
    AGENT.path,
  )
  assert(said)
  assertEquals(said.headers.get('vary'), 'accept')
  return { type: said.headers.get('content-type'), text: await said.text() }
}

test('the agent link is the markdown to an agent and a page to a browser', async () => {
  let text = sourceOf(`${AGENT.path}.md`)
  for (let accept of ['', '*/*', 'text/markdown, text/plain']) {
    assertEquals(await asked(accept), {
      type: 'text/markdown; charset=utf-8',
      text,
    })
  }
  let page = await asked('text/html,application/xhtml+xml,*/*;q=0.8')
  assertStringIncludes(page.type!, 'text/html')
  assertStringIncludes(page.text, `<title>${esc(AGENT.title)}</title>`)
  assertStringIncludes(page.text, '>Connect yaks.app</h1>')
  assertEquals(page.text.includes('Docs_Nav'), false)
  // The steps it hands Claude's person are the connect page's own link, and
  // the jump it offers lands on a heading the page has.
  assertStringIncludes(text, claudeAdd({}))
  let jump = /\]\(#([\w-]+)\)/.exec(text)![1]
  assertStringIncludes(page.text, `id="${jump}"`)
})

test('the drawn pages stop where the files start', async () => {
  for (let path of ['/docs/nothing', '/help', '/guide/querying']) {
    assertEquals(
      await answer(new Request(`https://yaks.app${path}`), site(), path),
      null,
      path,
    )
  }
})

// The documentation pages (docs.ts, T-37752): the guide's own markdown drawn
// as pages of this site. What can rot here is the join between the two —
// a subject offered in the contents with no markdown behind it, a page whose
// heading never reaches its title, a guide link that still lands on a file a
// browser downloads — so each is asserted against the files themselves.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { headings, parse } from '@yaks/markdown'
import { front } from '@yaks/yaml'
import { answer, CONTENTS, DOCS, PATH, pathOf } from './docs.ts'
import type { Env } from './env.ts'
import { PAGES } from './guide.ts'
import { esc } from './html.ts'

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

Deno.test('/docs draws the guide with a link to every page', async () => {
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
  assertStringIncludes(html, '<a href="/docs/technical">Technical details</a>')
  assertStringIncludes(html, '<a href="/docs.md">/docs.md</a>')
  // A guide page is linked at the page beside this one, never at its .md.
  assertStringIncludes(html, 'href="/docs/querying"')
  assertEquals(html.includes('https://yaks.app/docs/querying.md'), false)
})

// A page is titled by the heading it opens with, which is the page's own name
// for itself — clipping.md is filed as "Saving from another site" and opens
// "Saving a page from another site", and the page a person lands on says the
// second.
let heading = (slug: string) =>
  /^# (.+)$/m.exec(
    Deno.readTextFileSync(
      new URL(`./public/docs/${slug}.md`, import.meta.url),
    ),
  )![1]

Deno.test('every guide page draws under its own heading', async () => {
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
      `>${name}</h1>`,
    )
    assertStringIncludes(html, '<a href="/docs">← Documentation</a>')
    assertStringIncludes(html, '<nav class="Nav"')
  }
})

// The sidebar is the whole documentation, on every page of it, with the page
// being read marked — a list that goes stale the day a page is added is the
// thing this asserts against CONTENTS itself.
let sidebar = (html: string) =>
  html.split('<nav class="Page_Side')[1].split('</nav>')[0]

Deno.test('every page of the documentation carries the whole list beside it', async () => {
  for (let at of [PATH, ...CONTENTS.map((p) => pathOf(p.slug))]) {
    let nav = sidebar(await read(at))
    assertEquals(
      [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
      [PATH, ...CONTENTS.map((p) => pathOf(p.slug))],
      at,
    )
    // Exactly one entry is the page being read, and it is this one.
    let current = [...nav.matchAll(/href="([^"]+)" aria-current="page"/g)]
    assertEquals(current.map((m) => m[1]), [at], at)
  }
})

// What is on the page, linked by the ids the renderer gave those very
// headings (@yaks/markdown). A contents list whose links land nowhere is
// worse than none, so both halves are asserted against the same file.
let fileAt = (path: string) =>
  Deno.readTextFileSync(new URL(`./public${path}`, import.meta.url))

let sourceOf = (path: string) => front(fileAt(path), path).body

Deno.test('a page lists its own sections, and every one of them is there', async () => {
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
Deno.test('the technical page is markdown drawn like the rest', async () => {
  assertEquals(PAGES.find((p) => p.slug == 'technical'), undefined)
  assertEquals(
    front(fileAt('/docs/technical.md'), 'technical.md').meta.guide,
    undefined,
  )
  let html = await read(pathOf('technical'))
  assertStringIncludes(html, '<title>Technical details · yaks.app</title>')
  assertStringIncludes(
    html,
    `href="${pathOf('technical')}" aria-current="page"`,
  )
  // The frame's width is asked for on the body, and the document is the
  // article inside it (T-37785).
  assertStringIncludes(html, '<body class="Docs">')
  assertStringIncludes(html, '<main class="Page">')
  assertStringIncludes(html, '<article class="Page_Body Prose">')
  assertEquals((html.match(/<main[\s>]/g) ?? []).length, 1)
  assertEquals((html.match(/<h1[\s>]/g) ?? []).length, 1)
  // A number read off the code is on the page; the comment naming where it
  // was read is in the file and nowhere on the page (@yaks/markdown).
  assertStringIncludes(html, '20 versions')
  assertStringIncludes(sourceOf('/docs/technical.md'), 'versions.ts KEEP = 20')
  assertEquals(html.includes('versions.ts'), false)
})

// The whole rule, on one page: the `.md` address is the FILE, the address
// without it is that same file drawn, and neither redirects to the other.
Deno.test('a page and its markdown are one text at two addresses', async () => {
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
    assertStringIncludes(html, `>${lead}</h1>`, at)
  }
})

// Every address these moved from answers a 301 rather than a 404: the links
// are in the world and in the resource list a connector cached (T-37793).
Deno.test('the addresses the documentation moved from redirect to it', async () => {
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

Deno.test('the drawn pages stop where the files start', async () => {
  for (let path of ['/docs/nothing', '/help', '/guide/querying']) {
    assertEquals(
      await answer(new Request(`https://yaks.app${path}`), site(), path),
      null,
      path,
    )
  }
})

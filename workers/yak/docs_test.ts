// The documentation pages (docs.ts, T-37752): the guide's own markdown drawn
// as pages of this site. What can rot here is the join between the two —
// a subject offered in the contents with no markdown behind it, a page whose
// heading never reaches its title, a guide link that still lands on a file a
// browser downloads — so each is asserted against the files themselves.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { headings, parse } from '@yaks/markdown'
import { front } from '@yaks/yaml'
import { answer, CONTENTS, DOCS, framed, PATH, pathOf } from './docs.ts'
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
    '<h1 id="building-an-app-on-yaksapp">Building an app on yaks.app</h1>',
  )
  assertEquals((html.match(/<h1[\s>]/g) ?? []).length, 1)
  for (let p of CONTENTS) {
    assertStringIncludes(
      html,
      `<a href="${pathOf(p.slug)}">${esc(p.title)}</a>`,
    )
  }
  // The technical page is one of them, and the markdown stays named for the
  // reader who wants the file rather than the page.
  assertStringIncludes(html, '<a href="/docs/technical">Technical details</a>')
  assertStringIncludes(html, '<a href="/guide.md">/guide.md</a>')
  // A guide page is linked at the page beside this one, never at its .md.
  assertStringIncludes(html, 'href="/docs/querying"')
  assertEquals(html.includes('https://yaks.app/guide/querying.md'), false)
})

// A page is titled by the heading it opens with, which is the page's own name
// for itself — clipping.md is filed as "Saving from another site" and opens
// "Saving a page from another site", and the page a person lands on says the
// second.
let heading = (slug: string) =>
  /^# (.+)$/m.exec(
    Deno.readTextFileSync(
      new URL(`./public/guide/${slug}.md`, import.meta.url),
    ),
  )![1]

Deno.test('every guide page draws under its own heading', async () => {
  for (let p of PAGES) {
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
    if (at == pathOf('technical')) continue // a file — see `framed` below
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
let sourceOf = (path: string) =>
  front(
    Deno.readTextFileSync(new URL(`./public${path}`, import.meta.url)),
    path,
  ).body

Deno.test('a page lists its own sections, and every one of them is there', async () => {
  for (let p of PAGES) {
    let html = await read(pathOf(p.slug))
    let toc = html.split('<nav class="Page_Aside')[1].split('</nav>')[0]
    let inside = headings(parse(sourceOf(`/guide/${p.slug}.md`)))
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

// The technical page is the one page of the documentation that is a file, so
// the frame is spliced into its bytes rather than drawn around them — and the
// words in the file are exactly the words served.
Deno.test('the technical page wears the same frame around untouched words', async () => {
  let file = Deno.readTextFileSync(
    new URL('./public/docs/technical.html', import.meta.url),
  )
  let html = await framed(new Response(file)).then((r) => r.text())
  let nav = sidebar(html)
  assertEquals(
    [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
    [PATH, ...CONTENTS.map((p) => pathOf(p.slug))],
  )
  assertStringIncludes(
    nav,
    `href="${pathOf('technical')}" aria-current="page"`,
  )
  assertStringIncludes(html, '<main class="Page Docs">')
  assertStringIncludes(html, '<article class="Page_Body Prose">')
  assertStringIncludes(html, '</article>\n</main>')
  // Untouched: every section of the file, still in it, and nothing drawn
  // twice.
  let body = file.split('<main class="Page Prose">')[1].split('</main>')[0]
  assertStringIncludes(html, body)
  assertEquals((html.match(/<main[\s>]/g) ?? []).length, 1)
  assertEquals((html.match(/<h1[\s>]/g) ?? []).length, 1)
})

Deno.test('/technical answers a permanent redirect to its page', async () => {
  let said = await got('/technical')
  assertEquals(said.status, 301)
  assertEquals(said.headers.get('location'), 'https://yaks.app/docs/technical')
})

// /docs/technical is a FILE, so nothing is drawn for it and the request falls
// through to the assets binding (index.ts).
Deno.test('the drawn pages stop where the files start', async () => {
  for (let path of ['/docs/technical', '/docs/nothing', '/help']) {
    assertEquals(
      await answer(new Request(`https://yaks.app${path}`), site(), path),
      null,
      path,
    )
  }
})

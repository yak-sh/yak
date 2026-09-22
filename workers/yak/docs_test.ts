// The documentation pages (docs.ts, T-37752): the guide's own markdown drawn
// as pages of this site. What can rot here is the join between the two —
// a subject offered in the contents with no markdown behind it, a page whose
// heading never reaches its title, a guide link that still lands on a file a
// browser downloads — so each is asserted against the files themselves.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { answer, CONTENTS, DOCS, pathOf } from './docs.ts'
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
  assertStringIncludes(html, '<h1>Building an app on yaks.app</h1>')
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
    // The document itself, not its frontmatter: the heading opens the page.
    assertStringIncludes(html.split('<main')[1].slice(0, 120), `<h1>${name}`)
    assertStringIncludes(html, '<a href="/docs">← Documentation</a>')
    assertStringIncludes(html, '<nav class="Nav"')
  }
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

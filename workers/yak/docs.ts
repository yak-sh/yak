// The documentation pages (T-37752). Owner, 2026-09-22: "can we also create a
// docs page? `technical` is close... maybe we rename that to `Documentation`?
// anyone technical would gravitate there anyway"
//
// One rule, everywhere (T-37793). Owner, 2026-09-22: "the lack of symmetry
// here is killing me. adding `.md` should get you the markdown page.
// presumably they should be the exact same text. `/docs` is `/docs.md`
// rendered as html". So a page of the documentation is at `/docs/<slug>`, its
// markdown at `/docs/<slug>.md`, and the map at `/docs` and `/docs.md`. The
// markdown IS the page: public/docs.md and public/docs/<slug>.md, which the
// assets binding serves as files at the `.md` addresses, and this file renders
// at the addresses without them. Nothing is generated ahead of time and no
// HTML is written beside the markdown, so a guide edit is a documentation
// edit.
//
// The technical page (public/docs/technical.md) is drawn from its own markdown
// like any other. The guide does not OFFER it — it answers a person asking
// where this runs, not an agent building an app — so it says no `guide` row in
// its frontmatter, it is no connector resource, and `TECHNICAL` below is the
// one place that knows it is there. Every number on it is read off the code,
// and the pointer is a comment in the file beside the words it holds up.
//
// `/technical` and the old `/guide` addresses answer 301, for the links
// already in the world and the resource list a connector cached.
import type { Token } from '@yaks/markdown'
import { front } from '@yaks/yaml'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import type { Env } from './env.ts'
import { type Page, PAGES } from './guide.ts'
import { esc } from './html.ts'
import { type Host, hosted, url } from './host.ts'
import { foot, head, html, top } from './shell.ts'

export let PATH = '/docs'

// What `/docs` says about itself. A drawn page has no file to read a title and
// a line back out of, so seo.ts lists it from here (`RENDERED`).
export let DOCS = {
  path: PATH,
  title: 'Documentation · yaks.app',
  description:
    'Everything an app on yaks.app can do: its store, queries, files, mail, ' +
    'code of its own, domains — the same guide an assistant reads.',
}

// The technical page's row. Every other page says this much in its own
// frontmatter (M-34605), read back by gen.ts; this one is no guide page, so
// the row it is listed and drawn by is written here instead.
let TECHNICAL: Page = {
  slug: 'technical',
  title: 'Technical details',
  brief: 'hosting, storage, limits and exports',
  description:
    'Where yaks.app runs, where your things are kept, what an app can do, ' +
    "and what it can't do yet.",
}

/** Every page of the documentation, in the order the contents offers them. */
export let CONTENTS: Page[] = [...PAGES, TECHNICAL]

export let pathOf = (slug: string) => `${PATH}/${slug}`

/** The guide's subject pages, drawn here (seo.ts `addresses`). */
export let DRAWN = PAGES.map((p) => pathOf(p.slug))

/** The markdown every one of these pages is drawn from: the same address plus
 * `.md`, which is the whole rule and what the sitemap lists. */
export let MARKDOWN = [PATH, ...CONTENTS.map((p) => pathOf(p.slug))]
  .map((path) => `${path}.md`)

/** The technical page as the site lists it (seo.ts `RENDERED`), the way the
 * gallery and the map are listed: drawn, so there is no file to read a title
 * and a line back out of. */
export let TECH = {
  path: pathOf(TECHNICAL.slug),
  title: `${TECHNICAL.title} · yaks.app`,
  description: TECHNICAL.description,
}

// The markdown links its own pages by their `.md` addresses, which is what an
// agent fetches. On a page of the site those links should land on the page
// beside this one, so the `.md` comes off while it renders — the files are
// untouched. Both link forms the pages use are covered: the angle-bracket form,
// which has to become a titled link because a relative address is no autolink,
// and an ordinary link's target.
let LABEL: Record<string, string> = Object.fromEntries(
  CONTENTS.map((p) => [p.slug, p.title]),
)

let linked = (source: string) =>
  source
    .replace(
      /<https?:\/\/[^\s<>]*\/docs\/(\w+)\.md>/g,
      (all, slug) => LABEL[slug] ? `[${LABEL[slug]}](${pathOf(slug)})` : all,
    )
    .replace(/<https?:\/\/[^\s<>]*\/docs\.md>/g, `[The guide](${PATH})`)
    .replace(
      /\]\(https?:\/\/[^\s()]*\/docs\/(\w+)\.md([^\s()]*)\)/g,
      (all, slug, rest) => LABEL[slug] ? `](${pathOf(slug)}${rest})` : all,
    )
    .replace(/\]\(https?:\/\/[^\s()]*\/docs\.md([^\s()]*)\)/g, `](${PATH}$1)`)

/** The document's own name: the first top-level heading it opens with. */
let titled = (tokens: Token[]) => {
  let lead = tokens.find((t) => t.type == 'heading' && t.depth == 1)
  return lead && lead.type == 'heading' ? lead.text : ''
}

// The renderer, loaded when a page is drawn: marked builds its grammar when
// it loads, and seo.ts imports this file for the addresses alone, so a static
// import had every cold start pay for it (T-37977).
let marked = () => import('@yaks/markdown')
type Md = Awaited<ReturnType<typeof marked>>

let markup = (md: Md, tokens: Token[]) =>
  tokens.length ? renderToString(md.render(tokens, h)) : ''

// The contents: every subject with the phrase it is offered by, and the one
// rule at the foot of it, since a reader who wants the file rather than the
// page is the reader this whole guide was written for.
let contents = () =>
  `<nav class="Docs_Pages" aria-label="Contents">
<h2>The pages</h2>
<ul>
${
    CONTENTS.map((p) =>
      `<li><a href="${pathOf(p.slug)}">${esc(p.title)}</a> — ${
        esc(p.brief)
      }</li>`
    ).join('\n')
  }
</ul>
<p class="Note Note-small">Add <code>.md</code> to any page's address for the
markdown an assistant reads: <a href="${PATH}.md">${PATH}.md</a>.</p>
</nav>`

let back = `<p class="Docs_Back"><a href="${PATH}">← Documentation</a></p>`

// The sidebar every page of the documentation wears: the whole list, in the
// order CONTENTS gives it, with the page being read marked. It is the SideNav
// control the management portal wears (controls.css), because a reader who has
// learned to move through their own pages already knows how to move through
// these. The map itself is the first entry — a reader on a subject page needs
// the way back more than they need a row that says nothing.
let side = (slug: string) => {
  let here = (s: string) => s == slug ? ' aria-current="page"' : ''
  return `<nav class="Page_Side SideNav Docs_Nav" aria-label="Documentation">
<a href="${PATH}"${here('')}>Overview</a>
<hr>
${
    CONTENTS.map((p) =>
      `<a href="${pathOf(p.slug)}"${here(p.slug)}>${esc(p.title)}</a>`
    ).join('\n')
  }
</nav>`
}

// What is on THIS page: its own sections, so a long subject can be crossed
// without scrolling it. The ids are the renderer's (@yaks/markdown
// `headings`), which is why nothing here has to slugify anything itself. A
// page with one section is a page that needs no contents list.
let onPage = (md: Md, tokens: Token[]) => {
  let rows = md.headings(tokens).filter((v) => v.depth == 2 || v.depth == 3)
  return rows.length < 2
    ? ''
    : `<nav class="Page_Aside Docs_Contents" aria-label="On this page">
<p class="Docs_Label">On this page</p>
<ul>
${
      rows.map((v) =>
        `<li class="Docs_Jump${
          v.depth == 3 ? ' Docs_Jump-sub' : ''
        }"><a href="#${esc(v.id)}">${esc(v.text)}</a></li>`
      ).join('\n')
    }
</ul>
</nav>`
}

// One documentation page, drawn. `lead` is the document's own heading, kept
// first so the page has exactly one h1; anything handed in as `under` sits
// between it and the rest of the document.
let page = (
  md: Md,
  env: Host,
  at: string,
  title: string,
  description: string,
  tokens: Token[],
  under = '',
  slug = '',
) => {
  let lead = tokens.findIndex((t) => t.type == 'heading' && t.depth == 1)
  let opening = tokens.slice(0, lead + 1)
  return html(
    `${head(env, title, description, at)}
</head>
<body class="Docs">
${top}
<main class="Page">
${side(slug)}
${onPage(md, tokens)}
<article class="Page_Body Prose">
${markup(md, opening)}
${under}
${markup(md, tokens.slice(lead + 1))}
</article>
</main>
${foot}
</body>
</html>`,
  )
}

// The markdown, as the site serves it: one fetch of the same file the `.md`
// address answers with, rewritten for this deployment's own host the way every
// other text asset is (index.ts). A page's frontmatter is the row the
// connector lists it by (gen.ts), not part of the document, so it comes off.
let source = async (env: Env, path: string) => {
  let got = await env.ASSETS.fetch(new Request(url(env, path)))
  return got.ok ? hosted(front(await got.text(), path).body, env) : null
}

// Where the documentation used to live (T-37793). The move is a move, so the
// old addresses redirect rather than answer: a `.md` under /guide is the same
// page's markdown under /docs, whatever slug it names, and a page that went
// away 404s at the new address the way it would have at the old one.
let MOVED = /^\/guide(\/[\w.-]+)?\.md$/

/** `/docs`, `/docs/<slug>`, and the 301s the addresses these moved from
 * answer. Null for anything else, so the assets are reached as they were. */
export let answer = async (
  req: Request,
  env: Env,
  path: string,
): Promise<Response | null> => {
  if (path == '/technical') {
    return Response.redirect(url(env, pathOf('technical')), 301)
  }
  let moved = MOVED.exec(path)
  if (moved) {
    return Response.redirect(url(env, `${PATH}${moved[1] ?? ''}.md`), 301)
  }
  if (req.method != 'GET' && req.method != 'HEAD') return null
  if (path == PATH) {
    let text = await source(env, '/docs.md')
    if (!text) return null
    let md = await marked()
    let tokens = md.parse(linked(text), { breaks: false })
    return page(
      md,
      env,
      url(env, PATH),
      DOCS.title,
      DOCS.description,
      tokens,
      contents(),
    )
  }
  let slug = path.startsWith(`${PATH}/`) ? path.slice(PATH.length + 1) : ''
  let row = CONTENTS.find((p) => p.slug == slug)
  if (!row) return null
  let text = await source(env, `/docs/${slug}.md`)
  if (!text) return null
  let md = await marked()
  let tokens = md.parse(linked(text), { breaks: false })
  return page(
    md,
    env,
    url(env, pathOf(slug)),
    `${titled(tokens) || row.title} · yaks.app`,
    row.description,
    tokens,
    back,
    slug,
  )
}

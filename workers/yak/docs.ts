// The documentation pages (T-37752). Owner, 2026-09-22: "can we also create a
// docs page? `technical` is close... maybe we rename that to `Documentation`?
// anyone technical would gravitate there anyway"
//
// The guide is markdown — public/guide.md and public/guide/<slug>.md — because
// markdown is what an agent fetches, and those files stay the one copy of it.
// This draws the same bytes as pages of the site: `/docs` is the map with a
// contents list, and `/docs/<slug>` is one subject. Nothing is generated ahead
// of time and no HTML is written beside the markdown, so a guide edit is a
// documentation edit. The `.md` addresses answer exactly as they did.
//
// The technical page is a page of the documentation too, and it is still a
// file: public/docs/technical.html, which the assets binding serves at
// /docs/technical without passing through here. Every number on it is read off
// the code (its own header comment), which is why it was not turned into
// prose. `/technical` answers a 301 for the links already in the world.
import { parse, render as drawn, type Token } from '@yaks/markdown'
import { front } from '@yaks/yaml'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import type { Env } from './env.ts'
import { PAGES } from './guide.ts'
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

// The technical page's row in the contents. It is written here because this
// list is what decides the ORDER and the labels of the documentation; the page
// itself owns the words in its own head.
let TECHNICAL = {
  slug: 'technical',
  title: 'Technical details',
  brief: 'hosting, storage, limits and exports',
}

/** Every page the contents list offers, in the order it offers them. */
export let CONTENTS = [
  ...PAGES.map(({ slug, title, brief }) => ({ slug, title, brief })),
  TECHNICAL,
]

export let pathOf = (slug: string) => `${PATH}/${slug}`

/** The subject pages drawn here, for the sitemap (seo.ts `addresses`). The
 * technical page is not among them: it is a file, so it is in `SITE`. */
export let DRAWN = PAGES.map((p) => pathOf(p.slug))

// The markdown links its own pages by their `.md` addresses, which is what an
// agent fetches. On a page of the site those links should land on the page
// beside this one, so the guide addresses are pointed at /docs while it
// renders — the files are untouched. Both spellings the guide uses are
// covered: the angle-bracket form, which has to become a titled link because a
// relative address is no autolink, and an ordinary link's target.
let LABEL: Record<string, string> = Object.fromEntries(
  PAGES.map((p) => [p.slug, p.title]),
)

let linked = (source: string) =>
  source
    .replace(
      /<https?:\/\/[^\s<>]*\/guide\/(\w+)\.md>/g,
      (all, slug) => LABEL[slug] ? `[${LABEL[slug]}](${pathOf(slug)})` : all,
    )
    .replace(/<https?:\/\/[^\s<>]*\/guide\.md>/g, `[The guide](${PATH})`)
    .replace(
      /\]\(https?:\/\/[^\s()]*\/guide\/(\w+)\.md([^\s()]*)\)/g,
      (all, slug, rest) => LABEL[slug] ? `](${pathOf(slug)}${rest})` : all,
    )
    .replace(/\]\(https?:\/\/[^\s()]*\/guide\.md([^\s()]*)\)/g, `](${PATH}$1)`)

/** The document's own name: the first top-level heading it opens with. */
let titled = (tokens: Token[]) => {
  let lead = tokens.find((t) => t.type == 'heading' && t.depth == 1)
  return lead && lead.type == 'heading' ? lead.text : ''
}

let markup = (tokens: Token[]) =>
  tokens.length ? renderToString(drawn(tokens, h)) : ''

// The contents: every subject with the phrase it is offered by, and the
// markdown addresses named once at the foot of it, since a reader who wants
// the file rather than the page is the reader this whole guide was written
// for.
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
<p class="Note Note-small">Every page here is also markdown, for an assistant
to read: <a href="/guide.md">/guide.md</a> and <a href="/llms-full.txt">/llms-full.txt</a>.</p>
</nav>`

let back = `<p class="Docs_Back"><a href="${PATH}">← Documentation</a></p>`

// One documentation page, drawn. `lead` is the document's own heading, kept
// first so the page has exactly one h1; anything handed in as `under` sits
// between it and the rest of the document.
let page = (
  env: Host,
  at: string,
  title: string,
  description: string,
  tokens: Token[],
  under = '',
) => {
  let lead = tokens.findIndex((t) => t.type == 'heading' && t.depth == 1)
  let opening = tokens.slice(0, lead + 1)
  return html(
    `${head(env, title, description, at)}
</head>
<body>
${top}
<main class="Page Prose Docs">
${markup(opening)}
${under}
${markup(tokens.slice(lead + 1))}
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

/** `/docs`, `/docs/<slug>`, and the 301 the old technical address answers.
 * Null for anything else, so /docs/technical falls through to its file. */
export let answer = async (
  req: Request,
  env: Env,
  path: string,
): Promise<Response | null> => {
  if (path == '/technical') {
    return Response.redirect(url(env, pathOf('technical')), 301)
  }
  if (req.method != 'GET' && req.method != 'HEAD') return null
  if (path == PATH) {
    let text = await source(env, '/guide.md')
    if (!text) return null
    let tokens = parse(linked(text), { breaks: false })
    return page(
      env,
      url(env, PATH),
      DOCS.title,
      DOCS.description,
      tokens,
      contents(),
    )
  }
  let slug = path.startsWith(`${PATH}/`) ? path.slice(PATH.length + 1) : ''
  let row = PAGES.find((p) => p.slug == slug)
  if (!row) return null
  let text = await source(env, `/guide/${slug}.md`)
  if (!text) return null
  let tokens = parse(linked(text), { breaks: false })
  return page(
    env,
    url(env, pathOf(slug)),
    `${titled(tokens) || row.title} · yaks.app`,
    row.description,
    tokens,
    back,
  )
}

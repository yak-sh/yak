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
// one place that knows it is there. Every number on it is read off the code:
// if the code stops being true, the page is wrong and gets fixed, so it says as
// little as it can and points at the guide for the rest. The file is served as
// it is written at /docs/technical.md, so it carries no comments.
//
// `/technical` and the old `/guide` addresses answer 301, for the links
// already in the world and the resource list a connector cached.
import type { Token } from '@yaks/markdown'
import { front } from '@yaks/yaml'
import { Body, SideNav } from '@yaks/ui/parts'
import { type ComponentChildren, h } from 'preact'
import type { Env } from './env.ts'
import { type Page, PAGES } from './guide.ts'
import { type Host, hosted, url } from './host.ts'
import { publicPage } from './public-cache.ts'
import { drawn, head } from './shell.ts'

export let PATH = '/docs'

// What `/docs` says about itself. A drawn page has no file to read a title and
// a line back out of, so seo.ts lists it from here (`RENDERED`).
export let DOCS = {
  path: PATH,
  title: 'Documentation · yaks.app',
  description:
    'Everything an app on yaks.app can do: frontend data, queries, files, ' +
    'email, backend code, domains — the same guide an assistant reads.',
}

// The technical page's row. Every other page says this much in its own
// frontmatter (M-34605), read back by gen.ts; this one is no guide page, so
// the row it is listed and drawn by is written here instead.
let TECHNICAL: Page = {
  slug: 'technical',
  title: 'Technical Details',
  brief: 'hosting, storage, limits and exports',
  description:
    'Where yaks.app runs, where data is stored, what an app can do, ' +
    'and its current limitations.',
}

// The link a person pastes into their own agent (T-135903): the page tells
// the agent how to connect itself to yaks.app, and which one step to hand back
// to the person where it can't. It is public/agent.md, drawn here for a
// browser. An agent's fetch that does not ask for HTML gets the markdown
// itself, so the link a person pastes needs no `.md`.
export let AGENT = {
  path: '/agent',
  title: 'Connect your AI agent to yaks.app',
  description:
    'Paste this link into Claude, ChatGPT or another AI agent, and it ' +
    'connects itself to yaks.app.',
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

let said = (md: Md, tokens: Token[]) =>
  tokens.length ? h(Body, {}, ...md.blocks(tokens, h)) : null

// The contents: every subject with the phrase it is offered by, and the one
// rule at the foot of it, since a reader who wants the file rather than the
// page is the reader this whole guide was written for.
let contents = () =>
  h(
    'nav',
    { class: 'Docs_Pages', 'aria-label': 'Contents' },
    h('h2', null, 'The pages'),
    h(
      'ul',
      null,
      CONTENTS.map((p) =>
        h(
          'li',
          { key: p.slug },
          h('a', { href: pathOf(p.slug) }, p.title),
          ' — ',
          p.brief,
        )
      ),
    ),
    h(
      'p',
      { class: 'Note Note-small' },
      'Add ',
      h('code', null, '.md'),
      " to any page's address for the markdown an assistant reads: ",
      h('a', { href: `${PATH}.md` }, `${PATH}.md`),
      '.',
    ),
  )

let back = h(
  'p',
  { class: 'Docs_Back' },
  h('a', { href: PATH }, '← Documentation'),
)

// The sidebar every page of the documentation wears: the whole list, in the
// order CONTENTS gives it, with the page being read marked. It is the SideNav
// the management portal wears (@yaks/ui `SideNav`), because a reader who has
// learned to move through their own pages already knows how to move through
// these. The map itself is the first entry — a reader on a subject page needs
// the way back more than they need a row that says nothing.
let side = (slug: string) => {
  let link = (href: string, face: string, on: boolean) =>
    h(SideNav.Link, {
      key: href,
      href,
      mod: on && 'on',
      'aria-current': on ? 'page' : undefined,
    }, face)
  return h(
    SideNav,
    { class: 'Page_Side Docs_Nav', 'aria-label': 'Documentation' },
    link(PATH, 'Overview', slug == ''),
    h(SideNav.Rule, {}),
    CONTENTS.map((p) => link(pathOf(p.slug), p.title, p.slug == slug)),
  )
}

// What is on THIS page: its own sections, so a long subject can be crossed
// without scrolling it. The ids are the renderer's (@yaks/markdown
// `headings`), which is why nothing here has to slugify anything itself. A
// page with one section is a page that needs no contents list.
let onPage = (md: Md, tokens: Token[]) => {
  let rows = md.headings(tokens).filter((v) => v.depth == 2 || v.depth == 3)
  return rows.length < 2 ? null : h(
    'nav',
    { class: 'Page_Aside Docs_Contents', 'aria-label': 'On this page' },
    h('p', { class: 'Docs_Label' }, 'On this page'),
    h(
      'ul',
      null,
      rows.map((v) =>
        h(
          'li',
          {
            key: v.id,
            class: v.depth == 3 ? 'Docs_Jump Docs_Jump-sub' : 'Docs_Jump',
          },
          h('a', { href: `#${v.id}` }, v.text),
        )
      ),
    ),
  )
}

// One documentation page, drawn. `lead` is the document's own heading, kept
// first so the page has exactly one h1; anything handed in as `under` sits
// between it and the rest of the document. A page outside the documentation
// passes no `slug`, and wears no sidebar.
let page = (
  md: Md,
  env: Host,
  at: string,
  title: string,
  description: string,
  tokens: Token[],
  under: ComponentChildren = null,
  slug?: string,
) => {
  let lead = tokens.findIndex((t) => t.type == 'heading' && t.depth == 1)
  return drawn(
    head(env, title, description, at),
    h(
      'main',
      { class: 'Page' },
      slug == null ? null : side(slug),
      onPage(md, tokens),
      h(
        'article',
        { class: 'Page_Body Prose' },
        said(md, tokens.slice(0, lead + 1)),
        under,
        said(md, tokens.slice(lead + 1)),
      ),
    ),
    { body: 'Docs' },
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
    return await publicPage(req, env, path, async () => {
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
        '',
      )
    })
  }
  if (path == AGENT.path) {
    let raw = !(req.headers.get('accept') ?? '').includes('text/html')
    return await publicPage(
      req,
      env,
      path,
      async () => {
        let text = await source(env, `${AGENT.path}.md`)
        if (!text) return null
        let drawn = raw ? null : await marked()
        let said = drawn
          ? page(
            drawn,
            env,
            url(env, AGENT.path),
            AGENT.title,
            AGENT.description,
            drawn.parse(linked(text), { breaks: false }),
          )
          : new Response(text, {
            headers: { 'content-type': 'text/markdown; charset=utf-8' },
          })
        said.headers.set('vary', 'accept')
        return said
      },
      undefined,
      raw ? 'md' : '',
    )
  }
  let slug = path.startsWith(`${PATH}/`) ? path.slice(PATH.length + 1) : ''
  let row = CONTENTS.find((p) => p.slug == slug)
  if (!row) return null
  return await publicPage(req, env, path, async () => {
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
  })
}

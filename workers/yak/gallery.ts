// The gallery (T-34475): the published apps their owners asked us to SHOW, at
// https://yaks.app/gallery, in the sitemap, and answerable to an agent over
// `gallery_search` signed in or out.
//
// Jeff, 2026-09-06: "when somebody publishes their app, they can have the
// option to submit it to the gallery. And then we can share those publicly on
// our website or searchable via mcp".
//
// Publishing already makes an app installable by anybody (tools.ts
// app_publish, app_install). This is the other half: being SHOWN. The two are
// deliberately different acts, because they are different promises — an offer
// is between the person who made the app and whoever goes looking for one, and
// a listing is us putting somebody's app on our own front door. So the app's
// owner asks (`gallery: true`) and the platform answers, and until it answers
// the app is not on any page here.
//
// WHY THE APPROVAL. M-4522: what goes out under our name is ours to allow.
// Nothing an agent says and nothing a person types can put an app on this
// site — the ask is one stamp, the listing is a second one, and the second is
// only ever written by somebody opening a link out of a letter to
// hello@yaks.app. That letter is the one channel an agent has no way into,
// which is exactly the shape space_delete's confirmation already has
// (erase.ts): the same `seal` from the kernel's own secret, the same GET that
// only ever DRAWS, the same POST that acts.
//
// The two words on the row (vocab.ts `gallery`) say the whole state:
//
//   nothing      the app never asked
//   asked_at     the owner asked, the letter went, nobody has answered
//   listed_at    we said yes — it is on the page and in the search
//
// WHAT DELISTS. Withdrawing is one word off the row: `gallery: false` and
// `app_unpublish` clear it, so a later publish has to ask again — a listing on
// our site is not something that comes back on its own. The TRASH is the other
// direction and does the opposite: nothing is written at all (erase.ts keeps
// every other word exactly as it was, which is what makes a restore exact) and
// every reader here screens a trashed app and a trashed space out. So a
// trashed app leaves the gallery the moment it is thrown away, and a restored
// one is back where it was without asking anybody twice.
import { r2Blobs } from '../../src/blobs_r2.ts'
import { opened, seal } from '../../src/token.ts'
import {
  type App,
  type Directory,
  type Space,
  stamp,
  url,
} from './directory.ts'
import type { Env } from './env.ts'
import { keyed, prefixOf } from './files.ts'
import { type Letter, REPLY_TO } from './mail.ts'
import { esc } from './pages.ts'
import { GALLERY, SITE_URL } from './seo.ts'

// Where the gallery lives, and where a letter's links land. What the page SAYS
// about itself — its title and its line — is seo.ts's, beside the same two
// facts about every other page of this site; a page the worker draws is still
// one of the site's pages, and the list it belongs to is kept in one place.
export let PATH = GALLERY.path
export let REVIEW = `${PATH}/review`

let SITE = SITE_URL

// The platform's own mailbox — the address every letter we send already
// answers to (mail.ts REPLY_TO), so the approval arrives where the platform's
// mail already arrives and nobody has to be told a second address.
export let DESK = REPLY_TO

// A week to get to it. Longer than the hour a space's death gets (erase.ts
// LIFE), because nothing here is destroyed and nobody is waiting at a form:
// the app goes on being an app whether or not the letter is ever opened, and a
// week is what makes a Monday letter still good on Friday. Unconfirmed it
// simply lapses, and the app stays asked — the tool answer and the space page
// both keep saying so, and asking again mints a fresh pair.
export let LIFE = 7 * 24 * 60 * 60_000

// What the letter's links carry: which app, which ANSWER, and the second it
// dies. The answer rides in the ticket rather than the query string for the
// reason `forever` does in erase.ts — the kernel signs it, so nobody can talk
// a decline into an approval by editing an address.
export type Ticket = { app: string; list: boolean; exp: number }

export let ticket = (app: App, list: boolean, secret: string) =>
  seal({ app: app.eid, list, exp: Date.now() + LIFE } satisfies Ticket, secret)

export let ticketed = async (
  token: string,
  secret: string,
  now = Date.now(),
): Promise<Ticket | null> => {
  let t = await opened<Ticket>(token, secret)
  return t && typeof t.app == 'string' && typeof t.exp == 'number' &&
      t.exp > now
    ? { app: t.app, list: !!t.list, exp: t.exp }
    : null
}

// The door the letter points at, with the ticket in hand.
export let door = (token: string) =>
  `${SITE}${REVIEW}?t=${encodeURIComponent(token)}`

// ---- what is on the row ------------------------------------------------

export type Standing = 'listed' | 'asked' | 'no'

export let standing = (app: App): Standing =>
  app.gallery?.listedAt ? 'listed' : app.gallery?.askedAt ? 'asked' : 'no'

// The one sentence every door says about where an app stands, so the tool
// answer, the space page and the review door never tell three stories.
export let saying = (at: Standing) =>
  at == 'listed'
    ? `listed in the gallery — ${SITE}${PATH}`
    : at == 'asked'
    ? 'waiting on us: it is not listed until we say yes, and a letter is on ' +
      'its way to the desk that decides'
    : 'not in the gallery'

// The word the space page's pill wears, which is the same three states said
// short enough to sit beside an app's name.
export let pilled = (at: Standing) =>
  at == 'listed' ? 'in the gallery' : at == 'asked' ? 'gallery: waiting' : ''

// ---- the listing -------------------------------------------------------

/** One app as the gallery shows it. `shot` is filled in only where a page is
 * being drawn — a search answers words, and reading everybody's bytes to say
 * them would be a subrequest per line. */
export type Shown = {
  eid: string
  /** the platform-wide name `app_install` takes */
  name: string
  title: string
  about: string
  /** the app's own address */
  at: string
  /** when we listed it — the order the page is in, newest first */
  since: string
  space: Space
  app: App
  shot?: string
}

let shownOf = (space: Space, app: App): Shown => ({
  eid: app.eid,
  name: app.published!.name,
  title: app.title,
  about: app.published!.about,
  at: url(space, app),
  since: app.gallery?.listedAt ?? '',
  space,
  app,
})

// Every app on the gallery, newest listing first. It reads the OFFERS
// (directory.ts) rather than a query of its own, because a listing is a
// published app and nothing else: unpublishing is what takes an app out of
// that list, and it takes it out of this one at the same moment without a
// second rule to keep in step.
//
// A trashed app and an app in a trashed space are screened here rather than
// unlisted on the row — see the note at the top of this file.
export let listed = async (dir: Directory): Promise<Shown[]> =>
  (await dir.offers())
    .filter(({ space, app }) =>
      app.gallery?.listedAt && !app.trashed && !space.trashed
    )
    .map(({ space, app }) => shownOf(space, app))
    .sort((a, b) => b.since.localeCompare(a.since))

// The line an agent runs to give somebody their own copy. It is the whole
// point of a listing: a gallery you cannot install from is a picture of apps.
export let install = (a: Shown) => `app_install(name: '${a.name}')`

// Matching by words, over the title and the description and nothing else —
// which is all a listing HAS to be matched on, and all it should be: a gallery
// entry is two short strings its owner wrote, so a word that is in neither is
// a word this app does not answer.
//
// Ranked in memory rather than through an index: the whole listing is read for
// the page anyway, both fields are already in hand, and an FTS table over them
// would be a second copy of two strings that live on one row. When there is a
// vector ranker to lean on (@yaks/recall, T-34473) this is the seam it lands
// at — one function, over the rows this one already has.
let words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? []

export let found = (all: Shown[], asked: string, limit = 10): Shown[] => {
  let want = [...new Set(words(asked))]
  if (!want.length) return all.slice(0, limit)
  let scored = all.map((a) => {
    let title = words(a.title)
    let about = words(a.about)
    let name = words(a.name)
    // A hit in the title is worth more than one in the description: a title is
    // what the thing IS, and a description mentions everything around it.
    let score = want.reduce(
      (n, w) =>
        n + (title.includes(w) ? 3 : 0) + (name.includes(w) ? 2 : 0) +
        (about.includes(w) ? 1 : 0),
      0,
    )
    return { a, score }
  }).filter((s) => s.score > 0)
  scored.sort((x, y) => y.score - x.score || x.a.since.localeCompare(y.a.since))
  return scored.slice(0, limit).map((s) => s.a)
}

// What `gallery_search` answers: the lines an agent reads, each carrying the
// install line, because the next thing to do with a result is take a copy.
export let said = (hits: Shown[], asked: string) =>
  hits.length
    ? hits.map((a) =>
      `- ${a.title}${a.about ? ` — ${a.about}` : ''}\n  ${a.at}\n  ${
        install(a)
      }`
    ).join('\n')
    : `nothing in the gallery answers ${
      asked ? `"${asked}"` : 'that'
    }. The whole gallery is ${SITE}${PATH}, and app_published lists every app ` +
      'anybody has offered, listed here or not'

// The whole of `gallery_search`, in one function, because it is answered at
// two doors: the signed-in tool (tools.ts) and the pre-auth one (preauth.ts
// `Looks`, mcp.ts), which must answer a stranger exactly what they would get
// signed in. The gallery is public — that is what being listed MEANS — so
// there is nothing here to narrow per caller, and one function is what keeps
// the two answers from drifting.
export let TOP = 25

export let searched = async (dir: Directory, args: Record<string, unknown>) => {
  let asked = typeof args.words == 'string' ? args.words : ''
  let want = typeof args.limit == 'number' && args.limit > 0
    ? Math.min(Math.floor(args.limit), TOP)
    : 10
  return said(found(await listed(dir), asked, want), asked)
}

// ---- the picture -------------------------------------------------------

// The app's own share card, read out of the bytes we already hold rather than
// fetched from its address: the platform stores every file an app serves
// (files.ts), so the picture costs a bucket read and no subrequest at all — and
// an app that is served by its own worker, or has no card, simply has none.
//
// Only the head is scanned. A page is somebody else's HTML and may be
// megabytes of it; what we are looking for is in the first few kilobytes or it
// is nowhere.
let HEAD = 8192

export let pictured = (html: string, at: string) => {
  let flat = html.slice(0, HEAD).replace(/\s+/g, ' ')
  let og = /<meta property="og:image" content="([^"]*)"/.exec(flat) ??
    /<meta content="([^"]*)" property="og:image"/.exec(flat)
  let src = og?.[1]?.trim()
  if (!src) return ''
  try {
    // An app writes its card relative to its own page as often as not, and a
    // relative address on OUR page would point at OUR files.
    return new URL(src, at).href
  } catch {
    return ''
  }
}

let shot = async (env: Env, a: Shown) => {
  let bytes = await r2Blobs(env.BLOBS).read(
    keyed(prefixOf(a.space, a.app), '/'),
  )
  return bytes ? pictured(new TextDecoder().decode(bytes), a.at) : ''
}

// The listing with every picture in it. One bucket read per app, in a list
// that is a page long by construction — and a read that fails is a missing
// picture, never a missing app.
export let pictures = async (env: Env, all: Shown[]) =>
  await Promise.all(all.map(async (a) => ({
    ...a,
    shot: await shot(env, a).catch(() => ''),
  })))

// ---- the page ----------------------------------------------------------

// What every page here wears in its head, in the shape the file pages wear it
// (public/*.html, site_test.ts): the title and the line, the canonical, the
// Open Graph pair a link unfurls with, and the site's own stylesheet. A page
// the worker draws is still one of the site's pages.
let head = (title: string, description: string, at: string, index = true) =>
  `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
${
    index
      ? ''
      : '<meta name="robots" content="noindex">\n'
  }<link rel="canonical" href="${esc(at)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="yaks.app">
<meta property="og:url" content="${esc(at)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}/og.png">
<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap">
<link rel="stylesheet" href="/style.css">`

// The site's own header and footer, said the way the files say them, so a page
// drawn here is not a page a visitor can tell apart from one that is a file.
// The nav is the same four places on every page of this site or it is not a
// nav (site_test.ts), and the footer the same seven. A page drawn here says
// them exactly as the files say them — the gallery is reached from the home
// page's showcase, not by growing the nav a fifth link on one page only.
let top = `<header class="Top">
<a class="Top_Name" href="/" aria-label="yaks.app, home"><span>yaks.app</span></a>
<nav class="Nav" aria-label="Site">
<a href="/#how">How it works</a>
<a href="/pricing">Pricing</a>
<a href="/technical">Technical</a>
<a href="/login">Sign in</a>
</nav>
</header>`

let foot = `<footer class="Foot">
<p>yaks.app · Yak Shaving LLC</p>
<ul class="Foot_Links">
<li><a href="/help">Help</a></li>
<li><a href="/technical">Technical</a></li>
<li><a href="/pricing">Pricing</a></li>
<li><a href="/terms">Terms</a></li>
<li><a href="/privacy">Privacy</a></li>
<li><a href="/acceptable-use">Acceptable use</a></li>
<li><a href="/cookies">Cookies</a></li>
</ul>
</footer>`

let html = (body: string, status = 200) =>
  new Response(`<!doctype html>\n<html lang="en">\n<head>\n${body}\n`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })

// One app, as a card: its name, what it is, the address it answers at, its own
// share card where it has one, and the line to run. The whole card is a link
// to the app itself — the install line is beside it rather than in it, because
// it is a thing to COPY and a link swallows the click.
export let card = (a: Shown) =>
  `<li class="Make_Card">
<a class="Make_Link" href="${esc(a.at)}">
${
    a.shot
      ? `<img class="Make_Shot" src="${
        esc(a.shot)
      }" alt="" loading="lazy" width="1200" height="630">`
      : `<img class="Make_Shot Make_Shot-none" src="/connector-512.png" alt="" loading="lazy" width="512" height="512">`
  }
<span class="Make_Name">${esc(a.title)} <span aria-hidden="true">↗</span></span>
${a.about ? `<span class="Note Note-small">${esc(a.about)}</span>` : ''}
<span class="Note Note-small">${esc(a.at.replace('https://', ''))}</span>
</a>
<p class="Make_Line"><code>${esc(install(a))}</code></p>
</li>`

// The gallery itself. The JSON-LD is the same list said for a machine — an
// ItemList of SoftwareApplications, which is what each of these is.
export let page = (all: Shown[]) =>
  html(`${head(GALLERY.title, GALLERY.description, `${SITE}${PATH}`)}
<script type="application/ld+json">
${
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': `${SITE}${PATH}`,
      url: `${SITE}${PATH}`,
      name: GALLERY.title,
      description: GALLERY.description,
      isPartOf: { '@id': `${SITE}/#website` },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: all.length,
        itemListElement: all.map((a, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'SoftwareApplication',
            name: a.title,
            description: a.about,
            url: a.at,
            applicationCategory: 'WebApplication',
            operatingSystem: 'Web browser',
          },
        })),
      },
    })
  }
</script>
</head>
<body>
${top}
<main class="Page">
<section class="Make" aria-labelledby="gallery">
<div class="Make_Intro">
<h1 id="gallery" class="Title">The gallery</h1>
<p class="Note">Apps people made here and asked us to show. Open one, or give
your assistant the line under it and it builds you your own copy — your own
address, your own data, nothing shared but the code.</p>
</div>
${
    all.length
      ? `<ul class="Make_List">${all.map(card).join('')}</ul>`
      : `<p class="Note">Nothing is listed yet. <a href="/login">Make something</a>
and ask your assistant to put it here.</p>`
  }
</section>
<section class="Join Card" aria-labelledby="yours">
<h2 id="yours" class="Title">Make one of your own</h2>
<p class="Note">Ask Claude or ChatGPT for an app and yaks.app hosts it at your
own address, with its own data.</p>
<p class="Join_Doors"><a class="Button" href="/login">Start free</a></p>
</section>
</main>
${foot}
</body>
</html>`)

// ---- the letter, and the door it points at -----------------------------

// The letter to the desk. Everything a decision needs is IN it — what the app
// is called, what it says it is, where it lives and who made it — because
// whoever reads it should not have to go looking, and the two links are the
// whole of the answer.
export let letter = (at: {
  title: string
  about: string
  url: string
  owner: string
  yes: string
  no: string
}): Letter => ({
  to: DESK,
  subject: `Gallery: ${at.title}?`,
  body: `${at.owner} asked to show an app on the yaks.app gallery.

  ${at.title}
  ${at.url}
  ${at.about || '(no description)'}
  by ${at.owner}

Nothing is listed until you say so — the gallery is a page on our own site,
under our own name.

Yes, list it:
${at.yes}

No, thank you:
${at.no}

Both links last a week and each one asks you once more before anything
happens. Ignore this and nothing is listed.`,
})

// The review page. It DRAWS on GET and acts on POST, for the reason the space
// delete does (erase.ts): a mail client that fetches every link in a letter
// before anyone reads it must not be able to list an app by doing its job.
//
// The ticket is the whole authority here — the kernel signed it and it went to
// one mailbox — so there is no cookie to check and nobody to be. That is the
// difference between this door and the space one: there, the person confirming
// owns the thing; here, the person confirming is us.
let review = (at: {
  title: string
  about: string
  url: string
  owner: string
  list: boolean
  token: string
  why?: string
  status?: number
}) =>
  html(
    `${
      head(
        at.list ? `List ${at.title}?` : `Decline ${at.title}?`,
        'A gallery listing, waiting on an answer.',
        `${SITE}${REVIEW}`,
        false,
      )
    }
</head>
<body>
${top}
<main class="Page">
<section class="Join Card">
<h1 class="Title">${at.list ? 'List this app?' : 'Decline this app?'}</h1>
${at.why ? `<p class="Note Say-no">${esc(at.why)}</p>` : ''}
<p class="Note"><b>${esc(at.title)}</b><br>${esc(at.url)}<br>${
      esc(at.about || '(no description)')
    }<br>by ${esc(at.owner)}</p>
<p class="Note">${
      at.list
        ? 'It appears at yaks.app/gallery, in the sitemap, and to an ' +
          'assistant searching the gallery.'
        : 'The ask is cleared. Nothing about the app changes, and its owner ' +
          'can ask again.'
    }</p>
<form method="post" action="${REVIEW}">
<input type="hidden" name="t" value="${esc(at.token)}">
<button type="submit">${at.list ? 'List it' : 'Decline it'}</button>
</form>
</section>
</main>
${foot}
</body>
</html>`,
    at.status ?? 200,
  )

let done = (title: string, lead: string, status = 200) =>
  html(
    `${head(title, lead, `${SITE}${REVIEW}`, false)}
</head>
<body>
${top}
<main class="Page">
<section class="Join Card">
<h1 class="Title">${esc(title)}</h1>
<p class="Note">${esc(lead)}</p>
<p class="Join_Doors"><a class="Button" href="${PATH}">The gallery</a></p>
</section>
</main>
${foot}
</body>
</html>`,
    status,
  )

// ---- the stamps --------------------------------------------------------
//
// Both words are server-owned (vocab.ts), so both go through the kernel's own
// door (directory.ts `stamp`) rather than a person's write — a listing is the
// platform's word about an app, never the app's about itself.

export let ask = (env: Env, app: App, now = new Date()) =>
  stamp(env, {
    entities: [{
      entity: { eid: app.eid },
      gallery: { asked_at: now.toISOString(), listed_at: null },
    }],
  })

export let list = (env: Env, app: App, now = new Date()) =>
  stamp(env, {
    entities: [{
      entity: { eid: app.eid },
      gallery: { listed_at: now.toISOString() },
    }],
  })

/** The word off the row entirely: un-asked and un-listed at once, which is
 * what withdrawing means (`gallery: false`, app_unpublish, a decline). */
export let drop = (env: Env, app: App) =>
  stamp(env, { entities: [{ entity: { eid: app.eid }, gallery: null }] })

// ---- the doors ---------------------------------------------------------

// The space's owner, for the byline in the letter and on the review page. The
// first owner on the roster: a space has one in every case that matters, and a
// space with several is one where any of them is the answer to "whose app is
// this".
export let owned = async (dir: Directory, space: Space) => {
  for (let person of await dir.members(space)) {
    if (await dir.role(space, person) == 'owner') return person
  }
  return ''
}

// The two addresses this file answers at the apex, and null for everything
// else, so index.ts falls through to the assets exactly as it did.
export let answer = async (
  req: Request,
  env: Env,
  path: string,
  dir: Directory,
): Promise<Response | null> => {
  if (path == PATH) {
    if (req.method != 'GET') return null
    return page(await pictures(env, await listed(dir)))
  }
  if (path != REVIEW) return null
  let asked = new URL(req.url)
  let form = req.method == 'POST'
    ? await req.formData().catch(() => new FormData())
    : new FormData()
  let held = req.method == 'POST'
    ? String(form.get('t') ?? '')
    : asked.searchParams.get('t') ?? ''
  let ok = env.SESSION_SECRET && held
    ? await ticketed(held, env.SESSION_SECRET)
    : null
  if (!ok) {
    return done(
      'That link has expired.',
      'A gallery link lasts a week. Nothing has changed, and the app can be ' +
        'put forward again.',
      410,
    )
  }
  // The app the ticket names, found among the offers — which is the whole of
  // what may be listed. An app that has been unpublished, deleted or thrown
  // away since the letter went is simply not there any more, and the answer
  // says so rather than stamping a row nothing points at.
  let at = (await dir.offers()).find(({ app }) => app.eid == ok.app)
  if (!at || at.app.trashed || at.space.trashed) {
    return done(
      'That app is no longer on offer.',
      'It has been unpublished, deleted, or is in the trash, so there is ' +
        'nothing to list. Nothing was changed.',
      409,
    )
  }
  let owner = await dir.nameAt(await owned(dir, at.space)) ?? at.space.slug
  let said = {
    title: at.app.title,
    about: at.app.published!.about,
    url: url(at.space, at.app),
    owner,
    list: ok.list,
    token: held,
  }
  if (req.method != 'POST') return review(said)
  if (ok.list) {
    await list(env, at.app)
    return done(
      `${at.app.title} is in the gallery.`,
      `It is on ${SITE}${PATH} now, and an assistant searching the gallery ` +
        'finds it.',
    )
  }
  await drop(env, at.app)
  return done(
    `${at.app.title} was not listed.`,
    'The ask is cleared. The app is untouched, and its owner can ask again.',
  )
}

// ---- the home page's examples ------------------------------------------

// "Made with yaks.app" on the front page (public/index.html), drawn from the
// same source as the gallery: the newest three listings, in place of the
// hand-written examples. Those examples stay in the file and stay the
// FALLBACK — a page whose showcase empties itself the first week nothing is
// listed is worse than one showing what could be made — so this replaces the
// list only when there is something to replace it with.
//
// A string splice rather than a template, because the page is a FILE: it is
// the one every crawler and every reader gets, it is edited by hand, and the
// showcase is one `<ul>` in it.
export let LIST = '<ul class="Make_List">'

export let showcase = (file: string, all: Shown[]) => {
  if (!all.length) return file
  let from = file.indexOf(LIST)
  if (from < 0) return file
  let to = file.indexOf('</ul>', from)
  if (to < 0) return file
  return file.slice(0, from + LIST.length) +
    all.slice(0, 3).map(card).join('') +
    file.slice(to)
}

// The home page as it is served: the file, with the newest listings in its
// showcase. A directory that will not answer is a home page with its own
// examples in it, never a home page that does not serve.
export let made = async (env: Env, dir: Directory, file: Response) => {
  let html = await file.text()
  let shown = await listed(dir).then((all) => pictures(env, all.slice(0, 3)))
    .catch(() => [] as Shown[])
  // The headers the assets door set, minus the two that describe the BYTES:
  // the body just changed length, and it is no longer the file that etag names.
  let headers = new Headers(file.headers)
  headers.delete('content-length')
  headers.delete('etag')
  return new Response(showcase(html, shown), { status: file.status, headers })
}

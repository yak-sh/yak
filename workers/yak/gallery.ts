// The gallery (T-34475): the published apps their owners asked us to show, at
// https://yaks.app/gallery, in the sitemap, and answerable to an agent over
// `gallery_search` signed in or out.
//
// Jeff, 2026-09-06: "when somebody publishes their app, they can have the
// option to submit it to the gallery. And then we can share those publicly on
// our website or searchable via mcp".
//
// Publishing already makes an app installable by anybody (tools.ts
// app_publish, app_install). This is the other half: being shown. The two are
// deliberately different acts, because they are different promises — an offer
// is between the person who made the app and whoever goes looking for one, and
// a listing is us putting somebody's app on our own front door. So the app's
// owner asks (`gallery: true`) and the platform answers, and until it answers
// the app is not on any page here.
//
// Why the review. M-4522: what goes out under our name is ours to allow, and
// the platform's owner is who allows it. Every ask is a letter to the
// platform's own mailbox, which reaches him, carrying two signed links to the
// review door. The door draws on a GET and acts on a POST, and only for an
// owner of the meta space signed in on the web (`staff`), the same line the
// space delete door draws (erase.ts).
//
// Jeff, 2026-10-28: "All gallery reviews come to me. You need the ability to
// *skip* review and to approve if I ask you to do so, but normal gallery
// review goes to me". So the platform admin's credential, which an agent
// holds, can do the same two things, and does them only when he asks: answer
// an ask (gallery_review), or list an app with no letter at all (`review:
// false` beside `gallery: true`, tools.ts `toGallery`); `yak admin gallery`
// calls one or the other. Every door writes one decision (`decision`), with
// the actor in by and the session or credential in via.
//
// A code review first, for somebody else's app. Jeff, 2026-10-28: "it's
// probably a good idea to have you do a code review approval of apps before
// they enter the gallery in the future. Probably not for all these internal
// ones, but for actual third-party apps". An ask from a space none of the
// platform's own people owns (tools.ts `ours`) writes to the agents instead
// (`CODE_REVIEW`), and his letter goes once an agent has read the code and
// said what it found (gallery_code_review, `code_review` on the row). He
// decides either way. An app of our own goes to him at once.
//
// The words on the row (vocab.ts `gallery`) say the whole state:
//
//   nothing      the app never asked
//   asked_at     the owner asked, the letter went, nobody has answered
//   listed_at    we said yes — it is on the page and in the search
//   reviewed_at  who decided, when and why (decision, by, via, reason)
//
// What delists. Withdrawing is one word off the row: `gallery: false` and
// `app_unpublish` clear it, so a later publish has to ask again — a listing on
// our site is not something that comes back on its own. The trash is the other
// direction and does the opposite: nothing is written at all (erase.ts keeps
// every other word exactly as it was, which is what makes a restore exact) and
// `offers()` (directory.ts) screens a trashed app and a trashed space out. So a
// trashed app leaves the gallery the moment it is thrown away, and a restored
// one is back where it was without asking anybody twice.
import { r2Objects } from './lib/objects.ts'
import { mediaTypeOf, type Objects } from '@yaks/blob'
import { blobPrefix } from './blob-key.ts'
import { opened, seal } from './lib/token.ts'
import {
  type App,
  type Directory,
  type Space,
  stamp,
  url,
} from './directory.ts'
import type { Env } from './env.ts'
import { configOf, keyed, prefixOf, rootOf } from './files.ts'
import type { Letter } from './mail.ts'
import type { Actor, Bundle } from '@yaks/graph'
import { esc } from './pages.ts'
import { GALLERY } from './seo.ts'
import { foot, head, html, top } from './shell.ts'
import { type Host, hosted, replyTo, url as siteUrl } from './host.ts'
import { browserOf } from './session.ts'
import { caught } from './defects.ts'
import { staff } from './admin.ts'
import { DEMO } from './gallery-demo.ts'
import type { Args, Ctx, Out } from './tool.ts'

// Where the gallery lives, and where a letter's links land. What the page says
// about itself — its title and its line — is seo.ts's, beside the same two
// facts about every other page of this site; a page the worker draws is still
// one of the site's pages, and the list it belongs to is kept in one place.
export let PATH = GALLERY.path
export let REVIEW = `${PATH}/review`
export let IMAGE = `${PATH}/image/`

// Where a code review is asked for: the yaks.app project's own address on the
// box (its project wears it), so the letter is filed as a priority-1 task on
// that project's board (@yaks/mail `mail_task`), which an agent picks up. It
// never reaches the platform's owner; his letter follows the review.
export let CODE_REVIEW = 'hello@bot.yak.sh'

// A week to get to it. Longer than the hour a space's death gets (erase.ts
// LIFE), because nothing here is destroyed and nobody is waiting at a form:
// the app goes on being an app whether or not the letter is ever opened, and a
// week is what makes a Monday letter still good on Friday. Unconfirmed it
// simply lapses, and the app stays asked — the tool answer and the space page
// both keep saying so, and asking again mints a fresh pair.
export let LIFE = 7 * 24 * 60 * 60_000

// What the letter's links carry: which app, which answer, and the second it
// dies. The answer rides in the ticket rather than the query string for the
// reason `forever` does in erase.ts — the kernel signs it, so nobody can talk
// a decline into an approval by editing an address.
export type Ticket = { app: string; list: boolean; exp: number }

export let ticket = (app: App, list: boolean, secret: string) =>
  seal(
    'review',
    { app: app.eid, list, exp: Date.now() + LIFE } satisfies Ticket,
    secret,
  )

export let ticketed = async (
  token: string,
  secret: string,
  now = Date.now(),
): Promise<Ticket | null> => {
  let t = await opened<Ticket>('review', token, secret)
  return t && typeof t.app == 'string' && typeof t.exp == 'number' &&
      t.exp > now
    ? { app: t.app, list: !!t.list, exp: t.exp }
    : null
}

// The door the letter points at, with the ticket in hand.
export let door = (token: string, env: Host = {}) =>
  `${siteUrl(env, REVIEW)}?t=${encodeURIComponent(token)}`

// ---- what is on the row ------------------------------------------------

export type Standing = 'listed' | 'asked' | 'no'

export let standing = (app: App): Standing =>
  app.gallery?.listedAt ? 'listed' : app.gallery?.askedAt ? 'asked' : 'no'

// The one sentence every door says about where an app stands, so the tool
// answer, the space page and the review door never tell three stories.
export let saying = (at: Standing, env: Host = {}) =>
  at == 'listed'
    ? `listed in the gallery — ${siteUrl(env, PATH)}`
    : at == 'asked'
    ? 'awaiting gallery review'
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

let shownOf = (space: Space, app: App, env: Host): Shown => ({
  eid: app.eid,
  name: app.published!.name,
  title: app.title,
  about: app.published!.about,
  at: url(space, app, env),
  since: app.gallery?.listedAt ?? '',
  space,
  app,
})

// Every app on the gallery, newest listing first. It reads the offers
// (directory.ts) rather than a query of its own, because a listing is a
// published app and nothing else: unpublishing is what takes an app out of
// that list, and it takes it out of this one at the same moment without a
// second rule to keep in step.
export let listed = async (
  dir: Directory,
  env: Host = {},
): Promise<Shown[]> => {
  let offers = await dir.offers()
  let demos = new Map(
    offers.filter(({ space, app }) =>
      space.slug == DEMO && app.access != 'private' && app.installed?.of
    ).map((offer) => [offer.app.installed!.of, offer]),
  )
  return offers
    .filter(({ app }) => app.gallery?.listedAt)
    .map(({ space, app }) => {
      let shown = shownOf(space, app, env)
      let demo = app.access == 'private' ? demos.get(app.eid) : null
      return demo
        ? {
          ...shown,
          at: url(demo.space, demo.app, env),
        }
        : shown
    })
    .sort((a, b) => b.since.localeCompare(a.since))
}

// The line an agent runs to give somebody their own copy. It is the whole
// point of a listing: a gallery you cannot install from is a picture of apps.
export let install = (a: Shown) => `app_install(name: '${a.name}')`

// Matching by words, over the title and the description and nothing else —
// which is all a listing has to be matched on, and all it should be: a gallery
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
export let said = (hits: Shown[], asked: string, env: Host = {}) =>
  hits.length
    ? hits.map((a) =>
      `- ${a.title}${a.about ? ` — ${a.about}` : ''}\n  ${a.at}\n  ${
        install(a)
      }`
    ).join('\n')
    : `nothing in the gallery answers ${
      asked ? `"${asked}"` : 'that'
    }. The whole gallery is ${
      siteUrl(env, PATH)
    }, and app_published lists every app ` +
      'anybody has offered, listed here or not'

// The whole of `gallery_search`, in one function, because it is answered at
// two doors: the signed-in tool (tools.ts) and the pre-auth one (preauth.ts
// `Looks`, mcp.ts), which must answer a stranger exactly what they would get
// signed in. The gallery is public — that is what being listed means — so
// there is nothing here to narrow per caller, and one function is what keeps
// the two answers from drifting.
export let TOP = 25

export let searched = async (
  dir: Directory,
  args: Record<string, unknown>,
  env: Host = {},
) => {
  let asked = typeof args.words == 'string' ? args.words : ''
  let want = typeof args.limit == 'number' && args.limit > 0
    ? Math.min(Math.floor(args.limit), TOP)
    : 10
  return said(found(await listed(dir, env), asked, want), asked, env)
}

// ---- the picture -------------------------------------------------------

// A chosen screenshot is an app upload, addressed by its bytes. Build its URL
// from the app's current address so an app move keeps the card working.
export let screenshot = (space: Space, app: App, env: Host = {}) =>
  !app.screenshot
    ? ''
    : app.access == 'private'
    ? siteUrl(env, `${IMAGE}${app.eid}/${app.screenshot}`)
    : `${url(space, app, env)}api/blob/${app.screenshot}`

/** A private app's selected gallery image is public with its listing. Every
 * request checks the current offer and selection before reaching the bucket. */
export let image = async (
  req: Request,
  dir: Directory,
  objects: Pick<Objects, 'read'>,
  path: string,
) => {
  let [eid, sha, extra] = path.slice(IMAGE.length).split('/')
  let at = !extra &&
    (await dir.offers()).find(({ app }) =>
      app.eid == eid && app.gallery?.listedAt && app.screenshot == sha
    )
  let bytes = at ? await objects.read(blobPrefix(at.space, at.app) + sha) : null
  let mime = bytes && mediaTypeOf(bytes)
  if (!bytes || !mime) {
    return new Response(null, {
      status: 404,
      headers: { 'cache-control': 'no-store' },
    })
  }
  return new Response(req.method == 'HEAD' ? null : bytes, {
    headers: {
      'content-type': mime,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

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
    // relative address on our page would point at our files.
    return new URL(src, at).href
  } catch {
    return ''
  }
}

export let pictureOf = async (env: Env, space: Space, app: App) => {
  let chosen = screenshot(space, app, env)
  if (chosen) return chosen
  let blobs = r2Objects(env.BLOBS)
  let prefix = prefixOf(space, app)
  let root = rootOf(prefix, await configOf(blobs, prefix))
  let bytes = await blobs.read(keyed(root, '/'))
  return bytes
    ? pictured(new TextDecoder().decode(bytes), url(space, app, env))
    : ''
}

// A chosen screenshot needs no bucket read. Older apps still use their
// og:image card, read from index.html, until their owner chooses one.
export let pictures = async (env: Env, all: Shown[]) =>
  await Promise.all(all.map(async (a) => ({
    ...a,
    shot: await pictureOf(env, a.space, a.app).catch((e) => {
      caught(e, { request: 'gallery picture' })
      return ''
    }),
  })))

// ---- the page ----------------------------------------------------------

// Trying the app and installing a copy are separate actions: its head is its
// name, linked to the app, and the copy it offers; its picture opens the app
// too.
export let card = (a: Shown) =>
  `<li class="Card Make_Card" id="${esc(a.name)}">
<header class="Card_Head"><h3 class="Card_Title"><a href="${esc(a.at)}">${
    esc(a.title)
  } <span aria-hidden="true">↗</span></a></h3><form class="Card_Actions" method="post" action="/install?name=${
    encodeURIComponent(a.name)
  }"><button class="Button" type="submit">Get a copy</button></form></header>
<a class="Make_Shot" href="${esc(a.at)}" tabindex="-1" aria-hidden="true">${
    a.shot
      ? `<img src="${
        esc(a.shot)
      }" alt="" loading="lazy" width="1200" height="630">`
      : `<img class="Make_Shot-none" src="/connector-512.png" alt="" loading="lazy" width="512" height="512">`
  }</a>
${a.about ? `<p class="Card_Sub">${esc(a.about)}</p>` : ''}
</li>`

// The gallery itself. The JSON-LD is the same list said for a machine — an
// ItemList of SoftwareApplications, which is what each of these is.
export let page = (all: Shown[], env: Host = {}) =>
  html(
    `${head(env, GALLERY.title, GALLERY.description, `${siteUrl(env, PATH)}`)}
<script type="application/ld+json">
${
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        '@id': `${siteUrl(env, PATH)}`,
        url: `${siteUrl(env, PATH)}`,
        name: GALLERY.title,
        description: GALLERY.description,
        isPartOf: { '@id': `${siteUrl(env, '/#website')}` },
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
<p class="Note">Explore apps made with yaks.app. Try one out or make it your own.</p>
</div>
${
      all.length
        ? `<ul class="Make_List">${all.map(card).join('')}</ul>`
        : `<p class="Note">No apps yet. <a href="/login">Make the first one.</a></p>`
    }
</section>
<section class="Join Card" aria-labelledby="yours">
<h2 id="yours" class="Title">Make one of your own</h2>
<p class="Note">Describe what you need. Your assistant builds it, and we keep it online.</p>
<p class="Join_Doors"><a class="Button" href="/login">Start free</a></p>
</section>
</main>
${foot}
</body>
</html>`,
  )

// ---- the letter, and the door it points at -----------------------------

// The letter to the platform's own mailbox (host.ts `replyTo`), which reaches
// its owner. Everything a decision needs is in it — what the app is called,
// what it says it is, where it lives and who made it — because whoever reads
// it should not have to go looking, and the two links are the whole of the
// answer.
export let letter = (at: {
  title: string
  about: string
  url: string
  owner: string
  yes: string
  no: string
  code?: Verdict
}, env: Host = {}): Letter => ({
  to: replyTo(env),
  subject: `Gallery: ${at.title}?`,
  body: `${at.owner} asked to show an app on the yaks.app gallery.

  ${at.title}
  ${at.url}
  ${at.about || '(no description)'}
  by ${at.owner}
${
    at.code
      ? `
An agent reviewed its code: ${at.code.verdict}.

${at.code.findings}
`
      : ''
  }
Yes, list it:
${at.yes}

No, thank you:
${at.no}

These links expire in one week.`,
})

// What an agent says of an app's code (gallery_code_review): approve or
// reject, and what it found. The platform's owner reads it beside the app.
export type Verdict = { verdict: 'approve' | 'reject'; findings: string }

// The letter asking for a code review (`CODE_REVIEW`). It names the release
// that would be copied, where the files are read, and the one command that
// records the review and sends the owner's letter.
export let codeReviewLetter = (at: {
  title: string
  about: string
  url: string
  owner: string
  app: string
  name: string
  version: number
}): Letter => ({
  to: CODE_REVIEW,
  replyTo: CODE_REVIEW,
  subject: `Code review: ${at.title} for the gallery`,
  body:
    `${at.owner} asked to show an app on the yaks.app gallery. Review its code
before the request goes to yaks.app's owner: what it does with people's data
and keys, whether it works as it says, and anything that should not go out
under our name (M-4522).

  ${at.title}
  ${at.url}
  ${at.about || '(no description)'}
  by ${at.owner}
  published as ${at.name} v${at.version}

Read its files as the platform admin:

  yak command app_files --space ${at.app.split('/')[0]} --app ${
      at.app.split('/')[1]
    } --op list --as admin@bot.yak.sh

Then record the review, which sends him the request with your verdict and
findings. He decides either way.

  yak admin gallery ${at.app} code-review --verdict approve --findings @findings.md --as admin@bot.yak.sh

--verdict reject when it should not be listed. Then close the task this letter
filed.`,
})

// The review page. It draws on GET and acts on POST, for the reason the space
// delete does (erase.ts): a mail client that fetches every link in a letter
// before anyone reads it must not be able to list an app by doing its job.
//
// The ticket says which app and which answer; the cookie says who is answering
// (`staff`). Both are needed: the ticket because the kernel signed what is
// being decided, the cookie because the letter also lands in the box's graph,
// where agents read mail.
let confirm = (at: {
  title: string
  about: string
  url: string
  owner: string
  list: boolean
  token: string
  why?: string
  status?: number
}, env: Host) =>
  html(
    `${
      head(
        env,
        at.list ? `List ${at.title}?` : `Decline ${at.title}?`,
        'Review a gallery submission.',
        `${siteUrl(env, REVIEW)}`,
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
        ? 'This app will appear in the public gallery.'
        : 'The app stays published. Its owner can submit it again.'
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

let done = (env: Host, title: string, lead: string, status = 200) =>
  html(
    `${head(env, title, lead, `${siteUrl(env, REVIEW)}`, false)}
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
      gallery: {
        asked_at: now.toISOString(),
        listed_at: null,
        reviewed_at: null,
        decision: null,
        by: null,
        via: null,
        reason: null,
      },
      code_review: null,
    }],
  })

/** The decision every door writes: the review link, gallery_review, and an
 * ask that skips review. A decline clears the pending ask while retaining who
 * decided and why. */
export let decision = (
  app: App,
  approve: boolean,
  actor: Actor,
  reason = '',
  now = new Date(),
): Bundle => ({
  entity: { eid: app.eid },
  gallery: {
    asked_at: approve ? app.gallery?.askedAt || now.toISOString() : null,
    listed_at: approve ? now.toISOString() : null,
    reviewed_at: now.toISOString(),
    decision: approve ? 'approved' : 'declined',
    by: actor.by ?? null,
    via: actor.via ?? null,
    reason,
  },
})

export let decide = (
  env: Env,
  app: App,
  approve: boolean,
  actor: Actor,
  reason = '',
) =>
  stamp(env, { entities: [decision(app, approve, actor, reason)] }, { actor })

/** The word off the row entirely: un-asked and un-listed at once, which is
 * what withdrawing means (`gallery: false`, app_unpublish). */
export let drop = (env: Env, app: App) =>
  stamp(env, {
    entities: [{ entity: { eid: app.eid }, gallery: null, code_review: null }],
  })

/** An agent's code review of the release asked about. A new ask or a
 * withdrawal clears it with the ask. */
export let reviewed = (
  app: App,
  code: Verdict,
  actor: Actor,
  now = new Date(),
): Bundle => ({
  entity: { eid: app.eid },
  code_review: {
    verdict: code.verdict,
    findings: code.findings,
    version: app.published?.version ?? 0,
    at: now.toISOString(),
    by: actor.by ?? null,
    via: actor.via ?? null,
  },
})

export let review = (env: Env, app: App, code: Verdict, actor: Actor) =>
  stamp(env, { entities: [reviewed(app, code, actor)] }, { actor })

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

// The review address this file answers at the apex. The public listing is
// drawn behind the Site entrypoint (site.ts), outside the review ticket door.
export let answer = async (
  req: Request,
  env: Env,
  path: string,
  dir: Directory,
  run: (ctx: Ctx, name: string, args: Args) => Promise<Out>,
): Promise<Response | null> => {
  if (path.startsWith(IMAGE) && ['GET', 'HEAD'].includes(req.method)) {
    return image(req, dir, r2Objects(env.BLOBS), path)
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
      env,
      'That link has expired.',
      'A gallery link lasts a week. Nothing has changed, and the app can be ' +
        'put forward again.',
      410,
    )
  }
  // Signed out, which is what an agent is here: sent to sign in and handed back
  // to this very page. Signed in as anybody but the platform's admin: refused.
  let who = await staff(req, env, dir)
  if (who == null) {
    let back = asked.pathname +
      (req.method == 'POST' ? `?t=${encodeURIComponent(held)}` : asked.search)
    return new Response(null, {
      status: 302,
      headers: { location: `/login?return=${encodeURIComponent(back)}` },
    })
  }
  if (!who) {
    return done(
      env,
      'Only yaks.app can answer this.',
      'A gallery request is answered by the platform, signed in. Nothing ' +
        'was changed.',
      403,
    )
  }
  // The app the ticket names, found among the offers — which is the whole of
  // what may be listed. An app that has been unpublished, deleted or thrown
  // away since the letter went is simply not there any more, and the answer
  // says so rather than stamping a row nothing points at.
  let at = (await dir.offers()).find(({ app }) => app.eid == ok.app)
  if (!at) {
    return done(
      env,
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
    url: url(at.space, at.app, env),
    owner,
    list: ok.list,
    token: held,
  }
  if (req.method != 'POST') return confirm(said, env)
  let session = await browserOf(req, env.SESSION_SECRET)
  await run({ env, dir, person: who }, 'gallery_review', {
    app: `${at.space.slug}/${at.app.slug}`,
    decision: ok.list ? 'approve' : 'decline',
    by: who,
    ...(session?.via ? { via: session.via } : {}),
  })
  if (ok.list) {
    return done(
      env,
      `${at.app.title} is in the gallery.`,
      `You can find it at ${siteUrl(env, PATH)}.`,
    )
  }
  return done(
    env,
    `${at.app.title} was not listed.`,
    'The app stays published. Its owner can submit it again.',
  )
}

// ---- the home page's examples ------------------------------------------

// These are the six examples promised on the home page. Gallery approval and
// listing recency do not decide which apps the platform features.
export let DEMOS = [
  'recipes',
  'garden',
  'bookclub',
  'trip',
  'guestbook',
  'chores',
]

export let examples = async (dir: Directory, env: Host = {}) => {
  let space = await dir.space('yourname')
  if (!space) return { demos: [] as Shown[], feature: '' }
  let apps = await dir.apps(space)
  let chosen = DEMOS.map((slug) => apps.find((app) => app.slug == slug))
  let demos = chosen.every((app) => app?.published && !app.trashed)
    ? chosen.map((app) => shownOf(space, app!, env))
    : []
  let vale = apps.find((app) => app.slug == 'vale' && !app.trashed)
  return { demos, feature: vale ? screenshot(space, vale, env) : '' }
}
//
// A string splice rather than a template, because the page is a file: it is
// the one every crawler and every reader gets, it is edited by hand, and the
// showcase is one `<ul>` in it.
export let LIST = '<ul class="Make_List">'

export let showcase = (file: string, all: Shown[], feature = '') => {
  if (feature) {
    file = file.replace(
      'src="mossvale.webp" data-feature-shot="vale"',
      `src="${esc(feature)}" data-feature-shot="vale"`,
    )
  }
  if (!all.length) return file
  let from = file.indexOf(LIST)
  if (from < 0) return file
  let to = file.indexOf('</ul>', from)
  if (to < 0) return file
  return file.slice(0, from + LIST.length) +
    all.map(card).join('') +
    file.slice(to)
}

// The home page as served: all six demos and the featured Mossvale image come
// from the apps' chosen screenshots. The file remains the fallback when the
// directory does not answer.
export let made = async (env: Env, dir: Directory, file: Response) => {
  let html = hosted(await file.text(), env)
  let failed = false
  let { demos: shown, feature } = await examples(dir, env)
    .then(async ({ demos, feature }) => ({
      demos: await pictures(env, demos),
      feature,
    }))
    .catch((e) => {
      failed = true
      caught(e, { request: 'home showcase' })
      return { demos: [] as Shown[], feature: '' }
    })
  // The headers the assets door set, minus those that describe the bytes: the
  // body just changed length, it is no longer the file that etag names, and the
  // assets' cache did not answer this page.
  let headers = new Headers(file.headers)
  headers.delete('content-length')
  headers.delete('etag')
  headers.delete('cf-cache-status')
  if (failed) headers.set('cache-control', 'private, no-store')
  return new Response(showcase(html, shown, feature), {
    status: file.status,
    headers,
  })
}

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
  NO_UPTAKE,
  type Shared,
  type Space,
  stamp,
  url,
} from './directory.ts'
import type { Env } from './env.ts'
import {
  type Reputation,
  reputation,
  reputationOf,
  reputed,
  type Standing,
} from './gallery-row.ts'
import { configOf, keyed, prefixOf, rootOf } from './files.ts'
import type { Letter } from './mail.ts'
import { INTERNAL } from './mail-config.ts'
import type { Actor, Bundle } from '@yaks/graph'
import { type ComponentChildren, h } from 'preact'
import { Button, Card, Notice } from '@yaks/ui/parts'
import { markup } from './html.ts'
import { GALLERY } from './seo.ts'
import { drawn, head } from './shell.ts'
import { type Host, hosted, replyTo, url as siteUrl } from '@yaks/platform/host'
import { sheeted } from './sheets.ts'
import { browserOf } from './session.ts'
import { caught } from './defects.ts'
import { DEMO } from './gallery-demo.ts'
import { DEMOS } from './demos.ts'
import { PICTURES } from './kept-page.ts'
import { opens } from './sample.ts'
import type { Args, Ctx, Out } from './tool.ts'

// Where the gallery lives, and where a letter's links land. What the page says
// about itself — its title and its line — is seo.ts's, beside the same two
// facts about every other page of this site; a page the worker draws is still
// one of the site's pages, and the list it belongs to is kept in one place.
export let PATH = GALLERY.path
export let REVIEW = `${PATH}/review`
export let IMAGE = PICTURES

// Where a code review is asked for: the yaks.app project's own address on the
// box (its project wears it), so the letter is filed as a priority-1 task on
// that project's board (@yaks/mail `mail_task`), which an agent picks up. It
// never reaches the platform's owner; his letter follows the review.
export let CODE_REVIEW = INTERNAL

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

export let ticket = (shared: Shared, list: boolean, secret: string) =>
  seal(
    'review',
    { app: shared.eid, list, exp: Date.now() + LIFE } satisfies Ticket,
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

// The one sentence every door says about where an app stands, so the tool
// answer, the space page and the review door never tell three stories.
export let saying = (at: Standing, env: Host = {}) =>
  at == 'listed'
    ? `listed in the gallery — ${siteUrl(env, PATH)}`
    : at == 'asked'
    ? 'awaiting gallery review'
    : 'not in the gallery'

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
  /** what yaks.app says of it (gallery-row.ts), where a listing read it */
  reputation?: Reputation
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

// Every published app as a stranger can open it. It reads the offers
// (directory.ts) rather than a query of its own, because a page for an app is
// a published app and nothing else: unpublishing is what takes an app out of
// that list, and it takes it out of this one at the same moment without a
// second rule to keep in step. A private app opens as its copy in the demo
// space, where there is one a stranger can open.
export let shown = async (
  dir: Directory,
  env: Host = {},
): Promise<Shown[]> => {
  let offers = await dir.offers()
  let demos = new Map(
    offers.filter(({ space, app }) =>
      space.slug == DEMO && opens(app) && app.installed?.of
    ).map((offer) => [offer.app.installed!.of, offer]),
  )
  return offers.map(({ space, app }) => {
    let shown = shownOf(space, app, env)
    let demo = app.access == 'private' ? demos.get(app.eid) : null
    return demo ? { ...shown, at: url(demo.space, demo.app, env) } : shown
  })
}

/** Each listing with what yaks.app says of it: its review, its installs,
 * counted in one read, and whether we feature it or its space. */
export let reputing = async (
  dir: Directory,
  all: Shown[],
): Promise<Shown[]> => {
  let n = await dir.uptakes(
    all.map((a) => ({ of: a.app.eid, maker: a.space.eid })),
  )
  return all.map((a) => ({
    ...a,
    reputation: reputation(a.app, n.get(a.app.eid) ?? NO_UPTAKE, a.space),
  }))
}

// Every app on the gallery, newest listing first, each with its reputation.
export let listed = async (
  dir: Directory,
  env: Host = {},
): Promise<Shown[]> =>
  reputing(
    dir,
    (await shown(dir, env))
      .filter(({ app }) => app.gallery?.listedAt)
      .sort((a, b) => b.since.localeCompare(a.since)),
  )

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
        a.reputation ? `${reputed(a.reputation).join('; ')}\n  ` : ''
      }${install(a)}`
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

// A chosen screenshot is an app upload, addressed by its bytes. The site serves
// it from the bucket by the app's eid and the sha, so a card's picture waits on
// no app's store and Site keeps it at the edge beside the listing (site.ts).
export let screenshot = (_space: Space, app: App, env: Host = {}) =>
  app.screenshot ? siteUrl(env, `${IMAGE}${app.eid}/${app.screenshot}`) : ''

// Where a card without a chosen screenshot finds its picture: the app's own
// og:image (`cardOf`), which only reading its files can tell. A listing names
// this address rather than reading them as it renders, and Site answers it with
// a redirect it keeps like a screenshot. A release of a published app purges
// it alone (facets/pages-graph.ts), so it follows the app's card.
export let CARD = 'card'

/** The address of the picture a listing shows for an app, from its row
 * alone. */
export let shotOf = (space: Space, app: App, env: Host = {}) =>
  screenshot(space, app, env) || siteUrl(env, `${IMAGE}${app.eid}/${CARD}`)

/** The listings, each with its picture's address. */
export let pictures = (all: Shown[], env: Host = {}): Shown[] =>
  all.map((a) => ({ ...a, shot: shotOf(a.space, a.app, env) }))

// Whom an offered app's picture is for: anyone, for a public app; a private
// one's only while it is listed or the home page features it.
let showing = ({ space, app }: { space: Space; app: App }) =>
  app.access != 'private' || !!app.gallery?.listedAt || featured(space, app)

/** An offered app's selected image: a public app's whenever it is offered, as
 * its own `/api/blob` serves it to anyone; a private app's with its listing, or
 * while the home page features it. Every render checks the current offer and
 * selection before reaching the bucket. Its `CARD` redirects to its picture,
 * or to the platform's yak when it has none. */
export let image = async (
  dir: Directory,
  objects: Pick<Objects, 'read'>,
  path: string,
  env: Host = {},
) => {
  let [eid, sha, extra] = path.slice(IMAGE.length).split('/')
  let offer = extra ? null : await dir.offer(eid)
  let at = offer && (sha == CARD || offer.app.screenshot == sha) &&
      showing(offer)
    ? offer
    : null
  if (at && sha == CARD) {
    let shot = screenshot(at.space, at.app, env) ||
      await cardOf(objects, at.space, at.app, env)
    return new Response(null, {
      status: 302,
      headers: { location: shot || siteUrl(env, '/yak.webp') },
    })
  }
  let bytes = at ? await objects.read(blobPrefix(at.space, at.app) + sha) : null
  let mime = bytes && mediaTypeOf(bytes)
  if (!bytes || !mime) {
    return new Response(null, {
      status: 404,
      headers: { 'cache-control': 'no-store' },
    })
  }
  return new Response(bytes, {
    headers: {
      'content-type': mime,
      'etag': `"${sha}"`,
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

let cardOf = async (
  blobs: Pick<Objects, 'read'>,
  space: Space,
  app: App,
  env: Host,
) => {
  let prefix = prefixOf(space, app)
  let root = rootOf(prefix, await configOf(blobs, prefix))
  let bytes = await blobs.read(keyed(root, '/'))
  return bytes
    ? pictured(new TextDecoder().decode(bytes), url(space, app, env))
    : ''
}

/** The picture an app's card shows: its chosen screenshot, else the og:image
 * its files name. Older apps use that card until their owner chooses one. */
export let pictureOf = async (env: Env, space: Space, app: App) =>
  screenshot(space, app, env) ||
  await cardOf(r2Objects(env.BLOBS), space, app, env)

// ---- the page ----------------------------------------------------------

// Trying the app is the card's one button; installing a copy is the quieter
// link beside it. Its name and its picture open the app too.
export let card = (a: Shown) =>
  h(
    Card,
    { as: 'li', class: 'Make_Card', id: a.name },
    h(
      Card.Head,
      null,
      h(Card.Title, { as: 'h3' }, h(Card.Link, { href: a.at }, a.title)),
      h(
        Card.Actions,
        null,
        h(
          Card.Form,
          {
            method: 'post',
            action: `/install?name=${encodeURIComponent(a.name)}`,
          },
          h(Button, { mod: 'quiet', type: 'submit' }, 'Get a copy'),
        ),
        h(
          Button,
          { mod: 'go', href: a.at },
          'Try it ',
          h('span', { 'aria-hidden': 'true' }, '↗'),
        ),
      ),
    ),
    h(
      'a',
      { class: 'Make_Shot', href: a.at, tabindex: -1, 'aria-hidden': 'true' },
      a.shot
        ? h('img', {
          class: 'Make_Image',
          src: a.shot,
          alt: '',
          loading: 'lazy',
          width: 1200,
          height: 630,
        })
        : h('img', {
          class: 'Make_Image Make_Shot-none',
          src: '/yak.webp',
          alt: '',
          loading: 'lazy',
          width: 384,
          height: 384,
        }),
    ),
    a.about ? h(Card.Sub, null, a.about) : null,
    a.reputation ? reputationOf(a.reputation) : null,
  )

// The card a gallery page stands on: its heading, what it says, and what
// follows from it.
let join = (title: string, ...rest: ComponentChildren[]) =>
  h(
    'main',
    { class: 'Page' },
    h(Card, { class: 'Join' }, h('h1', { class: 'Title' }, title), ...rest),
  )
let note = (...said: ComponentChildren[]) => h('p', { class: 'Note' }, ...said)
let back = () =>
  h(
    'p',
    { class: 'Join_Doors' },
    h(Button, { mod: 'go', href: PATH }, 'The gallery'),
  )

// The gallery itself. The JSON-LD is the same list said for a machine — an
// ItemList of SoftwareApplications, which is what each of these is.
export let page = (all: Shown[], env: Host = {}) =>
  drawn(
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
</script>`,
    h(
      'main',
      { class: 'Page' },
      h(
        'section',
        { class: 'Make', 'aria-labelledby': 'gallery' },
        h(
          'div',
          { class: 'Make_Intro' },
          h('h1', { id: 'gallery', class: 'Title' }, 'The gallery'),
          note(
            'Explore apps made with yaks.app. Try one out or make it your own.',
          ),
        ),
        all.length ? h('ul', { class: 'Make_List' }, all.map(card)) : note(
          'No apps yet. ',
          h('a', { href: '/login' }, 'Make the first one.'),
        ),
      ),
      h(
        Card,
        { class: 'Join', 'aria-labelledby': 'yours' },
        h('h2', { id: 'yours', class: 'Title' }, 'Make one of your own'),
        note(
          'Describe what you need. Your assistant builds it, and we keep it online.',
        ),
        h(
          'p',
          { class: 'Join_Doors' },
          h(Button, { mod: 'go', href: '/login' }, 'Start free'),
        ),
      ),
    ),
    { body: 'Gallery' },
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
  /** what is being listed: an app by default */
  what?: 'app' | 'skill'
}, env: Host) =>
  drawn(
    head(
      env,
      at.list ? `List ${at.title}?` : `Decline ${at.title}?`,
      'Review a gallery submission.',
      `${siteUrl(env, REVIEW)}`,
      false,
    ),
    join(
      at.list
        ? `List this ${at.what ?? 'app'}?`
        : `Decline this ${at.what ?? 'app'}?`,
      at.why ? h(Notice, { mod: 'negative', role: 'alert' }, at.why) : null,
      note(
        h('b', null, at.title),
        h('br', null),
        at.url,
        h('br', null),
        at.about || '(no description)',
        h('br', null),
        `by ${at.owner}`,
      ),
      note(
        at.what == 'skill'
          ? at.list
            ? 'Anyone on yaks.app will be able to install this version.'
            : 'It stays published, and nobody may install it.'
          : at.list
          ? 'This app will appear in the public gallery.'
          : 'The app stays published. Its owner can submit it again.',
      ),
      h(
        'form',
        { method: 'post', action: REVIEW },
        h('input', { type: 'hidden', name: 't', value: at.token }),
        h(
          Button,
          { mod: 'go', type: 'submit' },
          at.list ? 'List it' : 'Decline it',
        ),
      ),
    ),
    { status: at.status ?? 200 },
  )

let done = (env: Host, title: string, lead: string, status = 200) =>
  drawn(
    head(env, title, lead, `${siteUrl(env, REVIEW)}`, false),
    join(title, note(lead), back()),
    { status },
  )

// ---- the stamps --------------------------------------------------------
//
// Both words are server-owned (vocab.ts), so both go through the kernel's own
// door (directory.ts `stamp`) rather than a person's write — a listing is the
// platform's word about what is shared, never its own about itself.

export let ask = (env: Env, shared: Shared, now = new Date()) =>
  stamp(env, {
    entities: [{
      entity: { eid: shared.eid },
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
  shared: Shared,
  approve: boolean,
  actor: Actor,
  reason = '',
  now = new Date(),
): Bundle => ({
  entity: { eid: shared.eid },
  gallery: {
    asked_at: approve ? shared.gallery?.askedAt || now.toISOString() : null,
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
  shared: Shared,
  approve: boolean,
  actor: Actor,
  reason = '',
) =>
  stamp(env, { entities: [decision(shared, approve, actor, reason)] }, {
    actor,
  })

/** The word off the row entirely: un-asked and un-listed at once, which is
 * what withdrawing means (`gallery: false`, app_unpublish). */
export let drop = (env: Env, shared: Shared) =>
  stamp(env, {
    entities: [{
      entity: { eid: shared.eid },
      gallery: null,
      code_review: null,
    }],
  })

/** An agent's code review of the release asked about. A new ask or a
 * withdrawal clears it with the ask. */
export let reviewed = (
  shared: Shared,
  code: Verdict,
  actor: Actor,
  now = new Date(),
): Bundle => ({
  entity: { eid: shared.eid },
  code_review: {
    verdict: code.verdict,
    findings: code.findings,
    version: shared.published?.version ?? 0,
    at: now.toISOString(),
    by: actor.by ?? null,
    via: actor.via ?? null,
  },
})

export let review = (env: Env, shared: Shared, code: Verdict, actor: Actor) =>
  stamp(env, { entities: [reviewed(shared, code, actor)] }, { actor })

/** The platform's featured mark on something shared or on a space, or the
 * mark taken off (`gallery_feature`, T-160642). */
export let featuring = (
  eid: string,
  on: boolean,
  actor: Actor,
  now = new Date(),
): Bundle => ({
  entity: { eid },
  featured: on
    ? {
      at: now.toISOString(),
      by: actor.by ?? null,
      via: actor.via ?? null,
    }
    : null,
})

export let feature = (env: Env, eid: string, on: boolean, actor: Actor) =>
  stamp(env, { entities: [featuring(eid, on, actor)] }, { actor })

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

// The review address this file answers at the apex. The public listing and
// its pictures are drawn behind the Site entrypoint (site.ts), outside the
// review ticket door.
export let answer = async (
  req: Request,
  env: Env,
  path: string,
  dir: Directory,
  run: (ctx: Ctx, name: string, args: Args) => Promise<Out>,
): Promise<Response | null> => {
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
  let who = await (await import('./admin.ts')).staff(req, env, dir)
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
  let at = await dir.offer(ok.app)
  // Or a skill (shared-skill.ts): the same door, the same two answers.
  let skill = at ? null : await dir.skillOffered({ eid: ok.app })
  if (!at && !skill) {
    return done(
      env,
      'That is no longer on offer.',
      'It has been unpublished, deleted, or is in the trash, so there is ' +
        'nothing to list. Nothing was changed.',
      409,
    )
  }
  let space = at?.space ?? skill!.space
  let owner = await dir.nameAt(await owned(dir, space)) ?? space.slug
  let title = at?.app.title ?? skill!.skill.title
  let said = {
    title,
    about: at ? at.app.published!.about : skill!.skill.published.about,
    url: at
      ? url(at.space, at.app, env)
      : `the skill ${skill!.skill.published.name}, from ${space.slug}`,
    owner,
    list: ok.list,
    token: held,
    what: at ? 'app' as const : 'skill' as const,
  }
  if (req.method != 'POST') return confirm(said, env)
  let session = await browserOf(req, env.SESSION_SECRET)
  await run({ env, dir, person: who }, 'gallery_review', {
    ...at
      ? { app: `${at.space.slug}/${at.app.slug}` }
      : { skill: skill!.skill.published.name },
    decision: ok.list ? 'approve' : 'decline',
    by: who,
    ...(session?.via ? { via: session.via } : {}),
  })
  if (ok.list) {
    return done(
      env,
      at ? `${title} is in the gallery.` : `${title} is listed.`,
      at
        ? `You can find it at ${siteUrl(env, PATH)}.`
        : `Anyone may install it as ${skill!.skill.published.name}.`,
    )
  }
  return done(
    env,
    `${title} was not listed.`,
    at
      ? 'The app stays published. Its owner can submit it again.'
      : 'It stays published, and nobody may install it.',
  )
}

// ---- the home page's examples ------------------------------------------

// Whether the platform features an app: its own `featured` mark, or its
// space's (T-160642). Gallery approval and listing recency do not decide it.
export let featured = (space: Space, app: App) =>
  !!app.featured || !!space.featured

/** The demo space's apps at these addresses, in this order, as cards; none
 * unless every one is published. */
export let examples = async (
  dir: Directory,
  env: Host = {},
  slugs = DEMOS,
) => {
  let space = await dir.space(DEMO)
  if (!space) return [] as Shown[]
  let apps = await dir.apps(space)
  let chosen = slugs.map((slug) => apps.find((app) => app.slug == slug))
  return chosen.every((app) => app?.published && !app.trashed)
    ? chosen.map((app) => shownOf(space, app!, env))
    : []
}
//
// A string splice rather than a template, because the page is a file: it is
// the one every crawler and every reader gets, it is edited by hand, and the
// showcase is one `<ul>` in it, the carousel beside the hero.
export let LIST = '<ul class="Demo_Slides">'

// The showcase's place in a page's file: where its cards start and end.
let listIn = (file: string) => {
  let from = file.indexOf(LIST)
  let to = from < 0 ? -1 : file.indexOf('</ul>', from)
  return to < 0 ? null : { from: from + LIST.length, to }
}

/** The demos a page's file names, each card by its `data-demo`, in order. */
export let named = (file: string) => {
  let at = listIn(file)
  return at
    ? [...file.slice(at.from, at.to).matchAll(/ data-demo="([\w-]+)"/g)]
      .map((m) => m[1])
    : []
}

export let showcase = (file: string, all: Shown[]) => {
  let at = all.length ? listIn(file) : null
  return at
    ? file.slice(0, at.from) + all.map((a) => markup(card(a))).join('') +
      file.slice(at.to)
    : file
}

// A home page as served: every demo its file names is its app's card, with the
// app's chosen screenshot. The file remains the fallback when the directory
// does not answer, and a page with no showcase is served as its file.
export let made = async (env: Env, dir: Directory, file: Response) => {
  let html = sheeted(hosted(await file.text(), env), env)
  let failed = false
  let slugs = named(html)
  let shown = await Promise.resolve(
    slugs.length ? examples(dir, env, slugs) : [],
  )
    .then((demos) => pictures(demos, env))
    .catch((e) => {
      failed = true
      caught(e, { request: 'home showcase' })
      return [] as Shown[]
    })
  // The headers the assets door set, minus those that describe the bytes: the
  // body just changed length, it is no longer the file that etag names, and the
  // assets' cache did not answer this page.
  let headers = new Headers(file.headers)
  headers.delete('content-length')
  headers.delete('etag')
  headers.delete('cf-cache-status')
  if (failed) headers.set('cache-control', 'private, no-store')
  return new Response(showcase(html, shown), {
    status: file.status,
    headers,
  })
}

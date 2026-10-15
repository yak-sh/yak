// The connector's platform tools (D-32318 §Code, build, deploy): the least
// that makes an app. The generic graph tier is no longer here — @yaks/mcp
// brings graph_apply, graph_query, graph_show, graph_schema and search over
// the caller's reach as one graph (agent.ts, T-33812), and a second copy of
// them scoped to a (space, app) would be a dimmer one. What is here is the
// sugar: space_new, app_new,
// app_files, app_deploy, app_versions and app_rollback — the deploys an app
// keeps and the word that puts one back (versions.ts, T-32886) — app_set,
// app_delete, app_errors, app_list — the keys an app's worker reads are
// connections now, whose two tools are connections.ts's — the three that
// make an app a plugin: app_publish offers it to
// every space by a platform-wide name, app_unpublish withdraws the offer
// without touching anyone who took it, and app_published is what is on offer
// (T-32888), and the two that take one: app_install copies a published
// version into the caller's space as an ordinary app of theirs — its own
// store, its own R2 prefix, its own worker script, nothing shared but the
// code — pinned to the version it took, and app_update moves that pin,
// keeping the installer's data (T-32889) — and the two that say who an app
// is for: member_add and member_remove, the space
// owner's guest list, beside `app.access`, which is what an app lets a
// stranger with the link do (T-32504). A tool is one row here — name, what it
// does, its input as JSON Schema, and `run` — and agent.ts wears the table as
// a plugin's tools, which is how one server lists these beside the generic
// tier.
//
// src/mcp.ts's registry is the shape mirrored, not imported. Its `IO` seam
// wants fifteen methods — the whole eager graph, work lanes, the provider
// table, verification, the frozen-page upload — and its tools are this
// fleet's own: sessions, claims, memory, spawn. None of that exists in a
// hosted space. The rule for every write is session.ts's:
// an owner or editor of the space writes, a member reads, nobody else is
// answered at all. A deploy in v1 is a version bump, since an
// app's files serve live from its blob store — and the version it bumps to is
// kept, files and all, so app_rollback can put it back.
import { declarationOf, keepDeclaration } from './declaration.ts'
import type { Reload } from '@yaks/platform'
import { configured, deployWorker } from './deploy_worker.ts'
import type { Config } from './wrangler_app.ts'
import { compiled } from './esbuild.ts'
import { bindingLines, bindings } from './bindings.ts'
import { broken, mediaTypeOf, type Objects } from '@yaks/blob'
import { blobPrefix } from './blob-key.ts'
import { r2Objects, r2RawObjects } from './lib/objects.ts'
import { filesAt, staged, viewOf } from './release.ts'
import { isTestAddress } from './lib/bots.ts'
import { fullFiles } from './usage.ts'
import { TOOLS_EXAMPLE, viewsOf } from '@yaks/tools/declared'
import { appTools } from './tool-grammar.ts'
import type { Bundle } from '@yaks/graph'
import { VERSION } from './seo.ts'
import {
  appDoc,
  componentsOf,
  coreDocs,
  EXAMPLE,
  grew,
  homed,
  type Homes,
  lentDocs,
  livesIn,
  meant,
  stated,
  teach,
  unsaid,
  wordsOf,
} from './vocab.ts'
import { withKinds } from './kinds.ts'
import { mode } from '@yaks/member'
import type { PropSchema, VocabDoc } from '@yaks/vocab'
import type { Props, Sheet } from './csv.ts'
import {
  configOf,
  mimeOf,
  prefixOf,
  servesSaid,
  sourceOnly,
  warm,
  whereIn,
} from './files.ts'
import { perusal, peruse } from './files_read.ts'
import { drawn, ICON_SVG } from './raster.ts'
import { failedScript } from './asset_url.ts'
import { told as notify } from './stream.ts'
import {
  type Access,
  addresses,
  type App,
  appStore,
  clamped,
  daysLeft,
  directory,
  draftStore,
  folded,
  handle,
  homing,
  mailbox,
  META,
  MODES,
  type Role,
  type Space,
  stamp,
  TITLE,
  url,
} from './directory.ts'
import * as dirPart from './directory.ts'
import { latestSpeaks } from './lenses.ts'
import { sandboxed, sandboxing } from './installed.ts'
import { appFolder, landed, listing, sandboxPath } from './ship.ts'
import {
  listCommands,
  reachChanged,
  runCommand,
  toolsOf,
  viewsMoved,
} from './declared.ts'
// A whole store put back to a moment (T-34507) — the data half of what
// app_rollback does for an app's files.
import { mark, moment, oldest, putBack, recorded } from './recover.ts'
import {
  inspect as inspectWrites,
  retry as retryWrite,
  said as writesSaid,
} from './write-log.ts'
import { KERNEL } from './meta.ts'
import { inspect as inspectStore } from './store-inspect.ts'
// Only the ceiling, and only ever called: tools.ts and standing.ts are a
// cycle through declared.ts, so nothing from there may be read while this
// module's own body runs.
import { tooLong } from './standing.ts'
import { listable } from './shelf.ts'
import { meta, minted } from './meta.ts'
import {
  doomed,
  door,
  erase,
  erased,
  keeping,
  kept as inTrash,
  letter,
  naming,
  nobodys,
  refused,
  ticket,
  trash,
  trashSpace,
  untrash,
  untrashSpace,
  went,
} from './erase.ts'
import {
  apex,
  customOf,
  HOST,
  provision,
  reachable,
  reading,
  refresh,
  release,
} from './domains.ts'
import { bound, type Env } from './env.ts'
// The gallery is its own part (gallery.ts): the two stamps, the letter that
// carries the decision, and the listing every door here reads.
import {
  ask as askGallery,
  door as galleryDoor,
  drop as unGallery,
  letter as galleryLetter,
  pictureOf,
  saying,
  searched,
  type Standing,
  standing as onGallery,
  ticket as ticketFor,
} from './gallery.ts'
import type { Caller } from './identity.ts'
import {
  DEFAULT,
  GRANT,
  held as granted,
  HOURS,
  ledger,
  mint,
  revoke,
} from './grants.ts'
import { GRAPH, mail } from './mail.ts'
import { NARROW, PAGES, uriOf, whole } from './guide.ts'
import { asset, EITHER, NO_ARGS, PUBLIC, publics, what } from './preauth.ts'
import {
  awake,
  BUDGET,
  CAP,
  CWD,
  paid,
  seconds,
  spending,
  workbench,
} from './sandbox.ts'
import { machineDeclared, machineTools } from '@yaks/harness/machine'
import {
  connect,
  disconnect,
  feeOf,
  rate,
  refusedSell,
  selling,
} from './sell.ts'
import { mailFrom } from './post.ts'
import {
  apex as platformHost,
  replyTo,
  spaceHost,
  url as hostUrl,
} from './host.ts'
import { foreign, planSettings, RESERVED, SLUG } from './route.ts'
import { globs } from './router.ts'
import { vocabAt } from './reach.ts'
import { titling, vouched, type Who } from './session.ts'
import { type Clock, clock } from './timing.ts'
import { addressee, canon, nameOf } from './signin.ts'
import { ACCEPTED, type Door } from './door.ts'
import {
  type Applying,
  asked,
  loaded,
  loadParts,
  parts,
  seedy,
  sow,
  type Sown,
  span,
  type Text,
} from './seed.ts'
import { Pending, said as sentence } from './writes.ts'
import {
  archive,
  breaks,
  folds,
  healed,
  line,
  serve,
  trackedIn,
} from './unseen.ts'
import { scheduleUse } from './used.ts'
import {
  atCeiling,
  ceilings,
  count,
  countedSpend,
  free,
  gauged,
  heldAloud,
  monthOf,
  refusedSpend,
  requestUnits,
  size,
  SPACES,
  standingOf,
  tooManySpaces,
} from './meter.ts'
import { type Held, holding } from './held.ts'
import { an, invitedWords, room, send } from './invite.ts'
import { aloud, peopleOwned, shown } from './people.ts'
import {
  addressed,
  BUILT,
  deployedOver,
  fenced,
  type Files,
  KEEP,
  own,
  pins,
  record,
  releaseOf,
  same,
  sha256,
  unfenced,
  type Version,
  versions,
  waiting,
  whatChanged,
} from './versions.ts'
import {
  type Change,
  deleting,
  type Draft,
  drafting,
  history,
  modifying,
  replaced,
  restoring,
  served,
  when,
  type Written,
} from './written.ts'
import { appTag, purge } from './purge.ts'
import { keepable } from './page-cache.ts'
import { within } from './rate.ts'
import {
  admin,
  APP,
  type Args,
  asCaller,
  type Ctx,
  inApp,
  inBin,
  inSpace,
  type Out,
  ownSpace,
  refuse,
  rejected,
  type Row,
  seatIn,
  type Shape,
  SPACE,
  spaceBin,
  str,
  text,
  type Tool,
  worded,
} from './tool.ts'
import { read } from '@yaks/yaml'
import { viewsTools } from './views.ts'
import { connectionTools } from './connections.ts'
import { background, caught } from './defects.ts'

// What a tool IS, and the little kit for saying one, live in tool.ts — below
// this module, so a domain can say a row without importing the
// roster it joins. Said again here because this is still the door every other
// part of the Worker knows to ask.
export { type Args, type Ctx, inApp, type Out, type Shape, type Tool }

// The tool list, said out loud: the version that names it and every tool in
// it. It is what `about` adds for a signed-in caller — the answer to "is my
// list still the list", which a client cannot ask any other way.
let rostered = (ctx: Ctx) =>
  ctx.roster
    ? `The tools here right now, roster ${ctx.roster.version}:\n` +
      `${ctx.roster.names.join(', ')}\n\nIf a reply ever says the tool list ` +
      'changed, that is this version moving: reconnect, or call about again ' +
      'to see what is here.'
    : ''

// The apps in reach (standing.ts), whole: what each holds, the notes beside
// it, and what the person has said in the space. `initialize` named the apps
// and left the words out — a host classifies its instructions, and somebody
// else's prose there reads as an attempt to steer the model (T-34632) — so
// this is where they are handed over. Said here anyway for a second reason: a
// client caches the instructions at connect and a person's apps move under it,
// and an app made this morning is one the agent would otherwise not know to
// put this afternoon's recipe in.
let said = async (ctx: Ctx) => await ctx.standing?.() ?? ''

// How a caller got in, said the way a person would say it (identity.ts
// `Caller`).
let HOW: Record<Caller['via'], string> = {
  session: 'in a signed-in browser',
  oauth: 'through a connector you signed in to',
  grant: 'with a CLI grant',
}

// Who is asking, how they got in, and until when — the whoami a CLI has to
// have and had nowhere to ask (T-34385). It rides on `about` rather than
// standing as a tool of its own: "what is this place" and "who am I here" are
// one question, and `about` is the one tool every client may call, signed in
// or not — before signing in the answer to the second half is nobody, which is
// what the fixed text already says.
let whoami = async (ctx: Ctx) => {
  let who = ctx.who
  if (!who) return ''
  let me = await ctx.dir.known(ctx.person)
  return `You are signed in as ${me?.name ?? ctx.person}` +
    `${me ? ` <${me.email}>` : ''}, ${HOW[who.via]}` +
    `${who.grant ? ` ${who.grant}` : ''}` +
    `${
      who.space ? `, which reaches the space ${who.space} and no other` : ''
    }` +
    `${who.until ? `, until ${new Date(who.until * 1000).toISOString()}` : ''}.`
}

let HOSTNAME = str(
  'the full domain, as it will be typed into a browser: ' +
    'herbusiness.com, or www.herbusiness.com. No scheme and no path',
)

// What to say when the hostname is a domain's apex, where DNS forbids a
// CNAME. This is the step a non-technical person gives up at, so the answer
// they need is in the answer they already have, not a page away.
let apexHelp = (env: Env) =>
  'This is the apex — the bare domain, with nothing in front of it — and ' +
  'DNS does not allow a CNAME there. Three ways through, best first: move ' +
  "the domain's DNS to Cloudflare (free, and its CNAME flattening makes the " +
  "apex work), or use the registrar's own ALIAS/ANAME record type with the " +
  'same value (Porkbun has one; GoDaddy, Namecheap, Squarespace and Hover ' +
  'do not), or attach www.<domain> instead and redirect the apex to it. ' +
  'Call guide with page domains, which walks through each ' +
  `(${hostUrl(env, '/docs/domains.md')}).\n\n`

// What an app lets someone who is not a member do with its data (T-32504).
// The person's agent picks it from their ask, which is why the words are the
// ask and not the mechanism.
let ACCESS = {
  type: 'string',
  enum: [...MODES],
  description:
    "who may read and write the app's data: public (the default), anyone " +
    'with the link reads it, members with write permission change it; ' +
    'open, anyone with the link adds to it too and changes only what they ' +
    'added, which is what a vote page, a guest book or a signup sheet ' +
    'needs; private, nobody but the person ' +
    'and invited members may read; writing still needs a writer role',
}

let ROLES: Role[] = ['owner', 'editor', 'viewer']

// What app_files does to a file, in the order an app is built.
let OPS = [
  'list',
  'read',
  'write',
  'patch',
  'fetch',
  'delete',
  'history',
  'restore',
]

// The ops that need a writer, which is every one that changes a byte.
let WRITES = ['write', 'patch', 'fetch', 'delete', 'restore']

/**
 * What an `app_files` call is asking for, when it did not say. Bytes say what
 * a call is: a `files` batch is a write, and so is a lone path with `content`
 * (or `base64`) beside it, whether or not `op` came along — which is what the
 * tool's description has always promised and what used to refuse (T-34337).
 * Nothing but a path is still nothing: it names no act, and guessing `read`
 * from it would answer a file to someone who meant to write one.
 */
export let opOf = (args: Record<string, unknown>, batch: number) =>
  String(
    args.op ??
      (batch || args.content != null || args.base64 != null ? 'write' : ''),
  )

// A list argument, forgiving of a model that sends one id bare: a string
// and a list of one mean the same thing, and refusing the string would only
// teach the agent to guess again.
let list = (v: unknown, what: string) =>
  v == null ? [] : (Array.isArray(v) ? v : [v]).map((one) => text(one, what))

let decoder = new TextDecoder()
let decoded = (bytes?: Uint8Array) => decoder.decode(bytes)

// A file's bytes, from either encoding of them (T-34263): `content` is the
// text an app is almost always made of, and `base64` is what a file that is
// not text arrives as — the `.wasm` an app's worker imports, a picture. One
// of the two; naming neither is the `content` refusal, since text is what a
// model reaching for this tool means.
let bytesOf = (f: Record<string, unknown>, at = '') => {
  if (f.base64 == null) {
    return new TextEncoder().encode(text(f.content, `${at}content`))
  }
  // Wrapped at some width is still base64: a model that pretty-prints a long
  // string has not made a mistake, and `atob` would refuse the newlines.
  let sent = text(f.base64, `${at}base64`).replace(/\s+/g, '')
  try {
    return Uint8Array.from(atob(sent), (c) => c.charCodeAt(0))
  } catch {
    throw refuse('arguments', `${at}base64: not base64`)
  }
}

// The many-file form of a write: `files: [{path, content}]`, so an app is one
// call and not one call per file (C-32624 item 5). Each refusal says which
// entry was wrong, since the model sent them all at once.
let files = (
  v: unknown,
): { path: string; bytes: Uint8Array<ArrayBuffer> }[] => {
  if (v == null) return []
  if (!Array.isArray(v)) {
    throw refuse('arguments', 'files: a list of {path, content}')
  }
  return v.map((one, i) => {
    if (!one || typeof one != 'object') {
      throw refuse('arguments', `files[${i}]: {path, content}`)
    }
    let f = one as Record<string, unknown>
    return {
      path: text(f.path, `files[${i}].path`),
      bytes: bytesOf(f, `files[${i}].`),
    }
  })
}

let access = (v: unknown): Access => {
  let s = text(v, 'access')
  if (!(MODES as readonly string[]).includes(s)) {
    throw refuse('arguments', `access: one of ${MODES.join(', ')}`)
  }
  return s as Access
}

// A CSS colour (apps.ts `manifesting`/`pinned`, T-33055) — a hex triple like
// `#4c773e`, an `rgb()`/`hsl()` function, or a named colour. Loose enough for
// any of those, tight enough that it can never break out of the HTML
// attribute it is woven into unescaped.
let CSS_COLOR = /^[#a-zA-Z0-9(),.%\s-]{1,64}$/
let color = (v: unknown, what: string) => {
  let s = text(v, what).trim()
  if (!CSS_COLOR.test(s)) {
    throw refuse('arguments', `${what}: a CSS colour like #4c773e`)
  }
  return s
}

// A yes or a no. Models send a JSON boolean where the schema says one and
// the word where they are typing prose, so both are read rather than
// teaching an agent to guess again (`list` above takes the same line).
let flag = (v: unknown, what: string) => {
  if (typeof v == 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  throw refuse('arguments', `${what}: true or false`)
}

let role = (v: unknown): Role => {
  let s = text(v, 'role')
  if (!(ROLES as string[]).includes(s)) {
    throw refuse('arguments', `role: one of ${ROLES.join(', ')}`)
  }
  return s as Role
}

// An address, in the one spelling the platform stores (signin.ts canon), so
// an invite and the sign-in that answers it are the same person.
let address = (v: unknown) => {
  let at = canon(text(v, 'email'))
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(at)) {
    throw refuse('arguments', 'email: an address like name@example.com')
  }
  return at
}

// A domain, as forgivingly as the rest of this file reads an argument: a
// model that pastes `https://herbusiness.com/` means the hostname in it, and
// refusing that would only teach it to guess again. A trailing dot is the
// same name, and the store keeps one spelling.
let hostname = (v: unknown) => {
  let s = text(v, 'hostname').trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '')
  if (!HOST.test(s)) {
    throw refuse(
      'arguments',
      'hostname: a domain like herbusiness.com or www.herbusiness.com',
    )
  }
  return s
}

// The place a domain points at, written the way every other answer here
// writes an address: the space alone, or the one app in it (T-34596).
let place = (space: Space, app: App | null) =>
  app ? `${space.slug}/${app.slug}` : space.slug

// And what that means at the domain, in a sentence, because the difference is
// the whole feature: a space's domain is the space's own hostname under
// another name, and an app's domain is that app and nothing else.
let serving = (host: string, app: App | null) =>
  app
    ? `The app answers at https://${host}/.`
    : `Its front page answers at https://${host}/ and every app at ` +
      `https://${host}/<app>/.`

let slug = (v: unknown, what: string) => {
  let s = text(v, what)
  if (!SLUG.test(s)) {
    throw refuse('arguments', `${what}: not a slug (a-z, 0-9, -)`)
  }
  return s
}

// A slug about to become an address, which may not be one the platform keeps
// for itself (route.ts `RESERVED`).
let unreserved = (s: string, what: string) => {
  if (RESERVED.has(s)) {
    throw refuse(
      'conflict',
      `${what}: ${s} is kept for yaks.app itself, so that nobody reads an ` +
        'address as the platform speaking. Choose another.',
    )
  }
  return s
}

let fresh = (v: unknown, what: string) => unreserved(slug(v, what), what)

// A space's or an app's title: folded to one line, and refused over the cap
// with the number rather than cut, so the person's name is never half kept
// (directory.ts `folded`, T-37885).
let titled = (v: unknown) => {
  let s = folded(text(v, 'title'))
  let n = Array.from(s).length
  if (n > TITLE) {
    throw refuse(
      'arguments',
      `title: ${n} characters — ${TITLE} at most. A title is the app's or ` +
        "the space's name; what it is for belongs in its files.",
    )
  }
  return s
}

// The caller as the space's owner, of what a door found: who belongs is the
// owner's to say. An editor writes the data and the files; they do not hand
// out keys.
let owner = <T extends { space: Space; who: Who }>(it: T) => {
  if (it.who.role != 'owner') {
    throw refuse('access', `not the owner of ${it.space.slug}`)
  }
  return it
}

let owns = async (ctx: Ctx, args: Args) => owner(await inSpace(ctx, args, true))

// The caller as the space's owner, on one of its apps. Offering an app to the
// whole platform is the space's act, not one its editors make: an editor
// writes the app's files, and publishing hands the code to strangers.
let ownsApp = async (ctx: Ctx, args: Args) =>
  owner(await inApp(ctx, args, true))

// Asking for the gallery (gallery.ts, T-34476), from either door that takes
// the word — `app_publish(gallery: true)` and `app_set(gallery: true)`. The
// ask is one stamp and a letter to the desk that decides; the listing is not
// ours to write, here or anywhere else, because the page it lands on is ours
// (M-4522).
//
// Asking again while it is already listed changes nothing and says so: a
// second letter about a decision already made is noise at the one mailbox this
// whole mechanism depends on somebody reading.
let toGallery = async (ctx: Ctx, space: Space, app: App) => {
  if (!app.published) {
    throw refuse(
      'conflict',
      `${space.slug}/${app.slug} is not published — the gallery shows what ` +
        'people can install, so app_publish it first (or app_publish(app, ' +
        'gallery: true), which does both)',
    )
  }
  if (onGallery(app) == 'listed') return onGallery(app)
  if (!await pictureOf(ctx.env, space, app)) {
    throw refuse(
      'conflict',
      `${space.slug}/${app.slug} needs a screenshot before gallery review — ` +
        'upload an image to its /api/blob door and pass the returned eid to ' +
        'app_set(screenshot: …), or give its index.html an og:image',
    )
  }
  if (!ctx.env.SESSION_SECRET) {
    throw new Error('the platform cannot sign a gallery link here')
  }
  let owner = await ctx.dir.nameAt(ctx.person) ?? space.slug
  let secret = ctx.env.SESSION_SECRET
  // The letter first, the mark second: an ask nobody was told about is an app
  // waiting on a decision no one was asked to make, and it would sit there
  // saying so on the space page forever. A letter that will not send leaves
  // the row exactly as it was, and asking again is the whole retry.
  try {
    await mail(ctx.env)(galleryLetter({
      title: app.title,
      about: app.published.about,
      url: url(space, app, ctx.env),
      owner,
      yes: galleryDoor(await ticketFor(app, true, secret), ctx.env),
      no: galleryDoor(await ticketFor(app, false, secret), ctx.env),
    }, ctx.env))
  } catch (e) {
    throw new Error(
      `${space.slug}/${app.slug} is published, but the gallery could not be ` +
        'asked: the letter that carries the decision would not send. ' +
        'Nothing was changed — ask again, or leave it offered without being ' +
        'shown',
      { cause: e },
    )
  }
  await askGallery(ctx.env, app)
  return 'asked' as const
}

// What every app in the space declares as its own, in app order, oldest
// first — the routing table a deploy reads to find a word's home (T-32728).
// A store's `/vocab` answers only the words it homes, so a use never looks
// like a second declaration and the first entry here is always the home.
//
// Each answer is the document that store keeps (reach.ts `vocabAt`), keywords
// and all: a home's manifest is written back whole when a sibling grows it,
// and read as types alone it would come back with every `search` erased.
let vocabs = async (ctx: Ctx, space: Space, app?: App) => {
  // A trashed app keeps its store for restoration, but it no longer homes
  // component names for apps that are serving in the space.
  let all = (await ctx.dir.apps(space)).filter((a) => !a.trashed)
  if (app && !all.some((a) => a.eid == app.eid)) all = [...all, app]
  return new Map(
    await Promise.all(
      all.map(async (one) =>
        [one.slug, await vocabAt(ctx.env, space, one)] as const
      ),
    ),
  )
}

// Where each word of the space lives, oldest app first — the first app to
// declare a word is its home (T-32728), and a word this app already declares
// stays its own, because a store's vocabulary is additive forever. `said` is
// every app's manifest beside it, since growing a home means writing the
// home's whole manifest back.
//
// A sandboxed app (installed.ts, T-37926) is on neither side of that: it
// borrows no word, so every word it declares is planted in its own store, and
// it is no home, so the space's own apps never write their rows into a store
// whose code is a stranger's. Sandboxing it, or letting it out, moves its
// words at its next release.
let homesIn = async (ctx: Ctx, space: Space, slug: string, app?: App) => {
  let said = await vocabs(ctx, space, app)
  let ours = said.get(slug)?.$defs ?? {}
  let homes: Homes = {}
  if (app && sandboxed(app)) return { said, homes }
  let walled = new Set(
    (await ctx.dir.apps(space)).filter(sandboxed).map((a) => a.slug),
  )
  for (let [at, doc] of said) {
    if (at == slug || walled.has(at)) continue
    for (let [name, schema] of Object.entries(doc.$defs ?? {})) {
      if (name in homes || name in ours) continue
      homes[name] = { at, props: schema.properties ?? {} }
    }
  }
  return { said, homes }
}

// The bytes a serving release declared, even if its editable files have since
// moved. Rollback needs these to distinguish a borrow being withdrawn from a
// property another app still declares.
let releasedDoc = async (
  ctx: Ctx,
  blobs: Objects,
  app: App,
): Promise<VocabDoc> => {
  if (!app.version) return {}
  let at = (await ctx.dir.deploys(app)).find((v) => v.version == app.version)
  if (!at) throw refuse('missing', `no v${app.version} of ${app.slug}`)
  let file = ['vocab.yml', 'vocab.json'].find((name) => at.files[name])
  if (!file) return {}
  let bytes = await pins(blobs).get(at.files[file])
  if (!bytes) throw refuse('missing', `no blob for ${at.files[file]}`)
  return appDoc(decoded(bytes), file)
}

// The app's data files, as text (seed.ts) — the seed ones for a release, the
// ones a path names for store_load. Only the named ones are read: an app's
// bytes are its pictures as well as its pages, and neither caller has any
// business decoding those.
let texts = (
  blobs: Objects,
  prefix: string,
  paths: string[],
): Promise<Text[]> =>
  Promise.all(paths.map(async (path) => ({
    path,
    text: decoded(await blobs.get(prefix + path)),
  })))

// A data batch through the app's write door, as the caller: the refusal's
// sentence back where the store said no, null where it took the batch, and
// `Pending` thrown where the store's log kept it to apply later (a 202).
// `check` asks for a dry run, which identifies the refused bundle.
let applying =
  (store: Door, head: Record<string, string>, path = '/apply'): Applying =>
  (batch, check) => {
    return store.consume(`${path}${check ? '?check=1' : ''}`, async (r) => {
      let no = await sentence(r)
      if (r.status == 202) throw new Pending(no)
      return r.ok ? null : no
    }, {
      method: 'POST',
      body: JSON.stringify(batch),
    }, head)
  }

// `map {header: property}` as one argument: its shape, checked once, so a model
// that sent a list or a nested object hears that rather than a header that
// silently went nowhere. Whether a mapped name is a property is csv.ts's, which
// is where the header it came from is still known.
let mapping = (v: unknown): Record<string, string> | undefined => {
  if (v == null) return undefined
  if (typeof v != 'object' || Array.isArray(v)) {
    throw refuse('arguments', 'map: {"Serves how many": "serves"}')
  }
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([header, prop]) => [
      header,
      text(prop, `map[${JSON.stringify(header)}]`),
    ]),
  )
}

// What a CSV is read as (csv.ts): the component a row becomes, and the type
// each of its properties takes. The words are the platform's own plus this
// app's, each property as the word that names its type (vocab.ts
// `wordsOf`) — a core property that is a reference or a closed set holds the
// text a cell has anyway, and an object or a list is a cell of JSON.
let sheetOf = async (
  store: Door,
  as: string,
  map?: Record<string, string>,
  env: Pick<Env, 'APEX'> = {},
): Promise<Sheet> => {
  let mine = wordsOf(appDoc(await answer(store, '/vocab')))
  let words: Record<string, Props> = {}
  for (let doc of coreDocs()) Object.assign(words, wordsOf(doc))
  Object.assign(words, mine)
  if (!(as in words)) {
    throw refuse(
      'arguments',
      `as: ${as} is not a component — this app says ${
        Object.keys(mine).sort().join(', ') || 'none of its own yet'
      }, beside the platform's own words (doc, task, comment, …)${teach(env)}`,
    )
  }
  return { as, props: words[as], map }
}

// The head a write into an app's store wears when the platform makes it for
// somebody: the caller vouched for, and their name, so the rows carry their
// byline instead of the platform's (session.ts `titling`).
let byCaller = async (ctx: Ctx, who: Who) => ({
  ...vouched(who),
  ...await titling(ctx.dir, who.person),
})

// Whether a manifest can land on this app at all, asked before anything moves
// (app_update). The same two rules a deploy holds it to, both of which throw
// rather than answer: a word another app in the space homes keeps that home's
// property types (vocab.ts `homed`), and this app's own properties keep the
// types their rows were written under (`grew`). Neither writes, so a refusal
// leaves the app exactly as it was — code included.
let fits = async (
  ctx: Ctx,
  space: Space,
  app: App,
  store: Door,
  source: string,
  file: string,
  accepted: string[] = [],
) => {
  let { said, homes } = await homesIn(ctx, space, app.slug, app)
  let split = homed(
    unsaid(appDoc(source, file), said.get(app.slug), file, accepted),
    homes,
  )
  let mine = await store.consume(
    '/vocab',
    async (r) => r.ok ? meant(await r.json()) : {},
  )
  grew(mine, split.mine)
}

// A release, whichever door asked for it — app_deploy, app_install,
// app_update. Its private draft becomes one immutable source only after the
// version record commits: the components its vocab.json declares planted where the
// space says each word lives, the tools it declares beside them handed to the
// store, its worker.js uploaded to the dispatch namespace, and the version
// moved on — recorded as a version of its own (versions.ts), so app_rollback
// can put this release back later. The answer is every line said beneath the
// door's own sentence.
// A committed release stays successful even if its notification or reporter
// is unavailable. The store's door owns authentication and response cleanup.
export let releaseNotice = async (
  store: Door,
  version: number,
  tags: Record<string, string>,
  report = caught,
) => {
  try {
    await store.consume('/released', async (res) => {
      if (!res.ok) throw new Error(`release notice: ${res.status}`)
      await res.arrayBuffer()
    }, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version }),
    }, { 'x-yak-kernel': '1' })
  } catch (e) {
    try {
      report(e, tags)
    } catch { /* the release is already live */ }
  }
}

let published = async (
  ctx: Ctx,
  space: Space,
  standing: App,
  who: Who,
  store: Door,
  release: string,
  fence: string,
  files: Awaited<ReturnType<typeof staged>>,
  target?: Version,
  reload?: Reload,
  preserve = false,
  accepted: string[] = [],
) => {
  let c = ctx.clock ?? clock()
  let blobs = files.files
  let app = { ...standing, source: release }
  let prefix = fileKey(space, app, '')
  let bytesAt = (path: string) => blobs.read(prefix + path)
  // The reads the compile does not change, sent now and awaited after it,
  // since each is a round trip of its own and none waits on another
  // (T-124005): the versions this release follows, the app's manifest, and
  // for a release put back whole, whether its bytes are all still kept (a
  // head each, not the bytes).
  //
  // The versions say what this release will be called. Its seed is staged
  // under that version and applied when the directory moves the declaration
  // pointer. The manifest is the app's own components, if it declares any; a
  // manifest the store refuses fails the release: the words and the tables
  // must agree, and a half-planted vocabulary is what `unknown component` is
  // made of.
  let kept = target?.source && target.script ? target : undefined
  let held = pins(r2Objects(ctx.env.BLOBS))
  let early = Promise.all([
    versions(ctx.dir, standing),
    declaring(blobs, space, app),
    ...Object.values(kept?.files ?? {}).map(async (sha) => {
      if (!await held.has(sha)) throw refuse('missing', `no blob for ${sha}`)
    }),
  ])
  // A compile that refuses is the answer; these are read again by nobody.
  early.catch(() => {})
  // And the serving release's words, read before the next one is prepared,
  // which also gives a store first reached during a deploy the declaration
  // to keep on failure, and its uses beside it, for what this release stops
  // borrowing below. They wake the app store, which a compile refused before
  // the compiler is asked never needs: they go beside the compiler's round
  // trip, or once nothing needs compiling.
  let servingWords: Promise<[string, string]> | undefined
  let readServing = () => {
    servingWords ??= Promise.all([
      answer(store, '/vocab'),
      answer(store, '/uses'),
    ])
    servingWords.catch(() => {})
    return servingWords
  }
  if (kept) readServing()
  let parsed = await configured(bytesAt)
  // Every key under the app, listed once for the compile and the seed. The
  // release index also records any package-lock.json the compile writes.
  let keys = (await blobs.list(prefix)).map((k) => k.slice(prefix.length))
  // The folder the app's addresses serve has to hold something, or every
  // address would answer nothing.
  let dir = parsed.config.assets?.directory
  if (dir && !keys.some((k) => k.startsWith(`${dir}/`))) {
    throw refuse(
      'arguments',
      `wrangler's assets.directory is ${dir}, and ${dir} holds no files: ` +
        `ship the build into it (sandbox_ship with into: "${dir}") or name ` +
        'the folder it is in',
    )
  }
  // Compile in the private release candidate. A failure leaves serving alone.
  let made = kept ? { lines: [] } : await c.time(
    'compile',
    () =>
      compiled(
        ctx,
        space,
        app,
        parsed.config,
        keys,
        blobs,
        files.manifest,
        preserve,
        readServing,
      ),
  )
  // The release's index is complete once the compile has written into it, and
  // nothing selects it until `record` moves the pointers, so it goes to the
  // bucket now, beside everything below rather than after it (T-124005).
  let snapshot = c.time('snapshot', () => files.finish())
  snapshot.catch(() => {})
  let [[all, { file: vocabFile, source, pkg }], [, serving]] = await Promise
    .all([early, readServing()])
  let version = target?.version ?? (all[0]?.version ?? 0) + 1
  // And what its declaration is called. A rollback selects a version again,
  // so it declares under a name of its own: a declaration once written is
  // never written again, which is what lets discovery keep one
  // (declaration.ts).
  let pointer = target ? `${version}-${crypto.randomUUID()}` : String(version)
  let draft = draftStore(ctx.env.STORE, space, app, pointer)
  // The file the app declares its words in — and its name, for every sentence
  // below that tells somebody to go and edit it — with the packages whose
  // words its package.json lends it.
  let declaration = stated(source, vocabFile, pkg)
  if (target) accepted = Object.keys(declaration.$defs ?? {})
  // A command was once declared in a file of its own; it is an entry in the
  // manifest now (T-38021), and a file still saying one that way is refused in
  // the sentence that says where it goes, rather than left unread.
  let stray = (await Promise.all(
    ['tools.yml', 'tools.json'].map(async (file) =>
      await blobs.has(fileKey(space, app, file)) ? file : ''
    ),
  )).find(Boolean)
  if (stray) {
    throw refuse(
      'arguments',
      `${stray} is not read: a command is a $defs entry in ${vocabFile} ` +
        'marked "tool": true — move each one there, with each argument a ' +
        'JSON Schema and the ones a caller must send listed under required, ' +
        `and delete ${stray}: ${TOOLS_EXAMPLE}`,
    )
  }
  let planted: string[] = []
  let dropped: string[] = []
  // What this manifest moved, which naming the components does not say: a
  // renamed property arrives beside the old one, and the old one keeps every
  // row already written under it (C-32652 item 4).
  let added: string[] = []
  let retained: string[] = []
  // And the words this app uses rather than homes (T-32728).
  let uses: Record<string, string> = {}
  let staged: { app: App; release: string }[] = []
  // The manifest as written, which is where a kind says what it means. It is
  // what the tools below are generated from.
  let manifest: VocabDoc = {}
  let vocabTook = c.since()
  // The manifest as one document (vocab.ts `appDoc`, @yaks/yaml — the file
  // may be .json or .yml): a property's keywords ride all the way to the
  // store that plants it.
  // One word, one home: a word another app in the space already declares is
  // that app's, so this release records a use of it instead of planting a
  // second table, and any property it adds grows the HOME's.
  let { said, homes } = await homesIn(ctx, space, app.slug, app)
  manifest = unsaid(
    declaration,
    said.get(app.slug),
    vocabFile,
    accepted,
  )
  let split = homed(manifest, homes)
  uses = split.uses
  let peers: Promise<VocabDoc[]> | undefined
  let peerDocs = () =>
    peers ??= ctx.dir.apps(space).then((all) =>
      Promise.all(
        all.filter((one) =>
          one.eid != app.eid && !one.trashed && !sandboxed(one)
        ).map((one) => releasedDoc(ctx, blobs, one)),
      )
    )
  // A home release may withdraw a property its borrower still declares.
  // Build its next declaration from its own file and the serving files of
  // peers, rather than treating an empty column as permission to erase it.
  let current = said.get(app.slug)?.$defs ?? {}
  let changed = Object.entries(current).some(([name, schema]) =>
    !(name in (split.mine.$defs ?? {})) ||
    Object.entries(schema.properties ?? {}).some(([prop, was]) =>
      JSON.stringify(was) !=
        JSON.stringify(split.mine.$defs?.[name]?.properties?.[prop])
    )
  )
  if (changed) {
    let defs: Record<string, PropSchema> = { ...split.mine.$defs }
    let names = new Set([...Object.keys(current), ...Object.keys(defs)])
    for (let peer of await peerDocs()) {
      let homeWords: Homes = Object.fromEntries(
        [...names].map((name) => [name, {
          at: app.slug,
          props: defs[name]?.properties ?? {},
        }]),
      )
      for (
        let [name, props] of Object.entries(
          homed(peer, homeWords).grows[app.slug] ?? {},
        )
      ) {
        defs[name] = {
          ...(defs[name] ?? current[name] ?? peer.$defs?.[name]),
          component: true,
          properties: { ...defs[name]?.properties, ...props },
        }
      }
    }
    split.mine = { ...split.mine, $defs: defs }
  }
  let oldUses: Record<string, string> = JSON.parse(serving)
  let retired: Record<string, Record<string, string[]>> = {}
  if (Object.keys(oldUses).length) {
    let previous = await releasedDoc(ctx, blobs, app)
    let gone = Object.entries(oldUses).flatMap(([name, slug]) =>
      Object.keys(previous.$defs?.[name]?.properties ?? {})
        .filter((prop) => !(prop in (manifest.$defs?.[name]?.properties ?? {})))
        .map((prop) => ({ name, slug, prop }))
    )
    if (gone.length) {
      let docs = await peerDocs()
      for (let { name, slug, prop } of gone) {
        if (
          docs.some((doc) => prop in (doc.$defs?.[name]?.properties ?? {}))
        ) {
          continue
        }
        let props = retired[slug] ??= {}
        props[name] = [...(props[name] ?? []), prop]
      }
    }
  }
  // Stage the home's table before recording the consumer release. Its whole
  // manifest is written back, so it stays the document the home declared —
  // projected to types, a sibling's deploy would silently unsearch the
  // home's own properties (T-37546).
  for (
    let slug of new Set([
      ...Object.keys(split.grows),
      ...Object.keys(retired),
    ])
  ) {
    let home = await ctx.dir.app(space, slug)
    if (!home) continue
    let was = said.get(slug) ?? {}
    let defs: Record<string, PropSchema> = { ...was.$defs }
    for (let [name, props] of Object.entries(retired[slug] ?? {})) {
      let remaining = { ...defs[name]?.properties }
      for (let prop of props) delete remaining[prop]
      defs[name] = { ...defs[name], properties: remaining }
    }
    let grown = split.grows[slug] ?? {}
    for (let [name, props] of Object.entries(grown)) {
      defs[name] = {
        ...defs[name],
        properties: { ...defs[name]?.properties, ...props },
      }
      for (let prop of Object.keys(props)) added.push(`${name}.${prop}`)
    }
    let whole: VocabDoc = { ...was, $defs: defs }
    let release = crypto.randomUUID()
    await answer(appStore(ctx.env.STORE, space, home), '/vocab')
    await answer(
      draftStore(ctx.env.STORE, space, home, release),
      '/vocab',
      {
        method: 'POST',
        body: JSON.stringify(whole),
      },
      vouched(who),
    )
    await keepDeclaration(ctx.env, space, home, release, {
      vocab: JSON.parse(
        await answer(draftStore(ctx.env.STORE, space, home, release), '/vocab'),
      ),
      tools: (await declarationOf(ctx.env, space, home)).tools,
    })
    staged.push({ app: home, release })
  }
  let mine = JSON.parse(
    await answer(
      draft,
      '/vocab',
      {
        method: 'POST',
        body: JSON.stringify(split.mine),
      },
      { ...vouched(who), [ACCEPTED]: JSON.stringify(accepted) },
    ),
  )
  planted = mine.comps ?? []
  dropped = mine.dropped ?? []
  added = [...added, ...(mine.added ?? [])]
  retained = mine.kept ?? []
  await answer(
    draft,
    '/uses',
    {
      method: 'POST',
      body: JSON.stringify(uses),
    },
    vouched(who),
  )
  // The words the candidate accepted, read once for the tools below and the
  // declaration this release keeps: nothing after this changes them.
  let [taken, borrowed] = await Promise.all([
    answer(draft, '/vocab'),
    answer(draft, '/uses'),
  ])
  vocabTook('vocab')
  // And the app's own commands (T-32685, T-38021): the manifest's `$defs`
  // entries marked `"tool": true`, read after the components, since a tool may
  // write a word this very release planted. The declaration is replaced whole
  // — it holds no rows — so an app whose manifest declares none releases none.
  // The file was read above and refused there if it does not parse, so this
  // reads the same bytes as a value (@yaks/yaml), whichever format they are.
  let sent = source?.trim() ? read(source, vocabFile) : {}
  // A `view` names a page in the app's own files (T-32687), so this is the one
  // thing about the manifest the store cannot check: it holds the words, the
  // blobs hold the pages. A view nobody deployed would be a tool whose answer
  // renders nothing, which is worse than a refusal.
  let missing: string[] = []
  for (let file of viewsOf(sent)) {
    if (!await blobs.has(fileKey(space, app, file))) missing.push(file)
  }
  if (missing.length) {
    throw refuse(
      'arguments',
      `${vocabFile}: ${missing.join(', ')} — a view names a page in this ` +
        "app's own files; deploy the page beside index.html",
    )
  }
  // And the manifest is checked here, against the words this app has after the
  // release above: a tool writing a component nobody declared is refused where
  // the vocabulary can be read. The store keeps a declaration as written
  // (graph.ts `/tools`) — a store that parsed its own tools would be a second
  // vocabulary inside the object, and the one that plants the words is the one
  // that can say which they are.
  // A tool is checked against the names, so the names are all this reads: the
  // core every app's store plants, the app's own, the ones its dependencies
  // lend, and the ones it borrows.
  let accepting = appDoc(JSON.parse(taken))
  let words = [
    ...componentsOf(coreDocs()),
    ...componentsOf([accepting, ...lentDocs(accepting)]),
    ...Object.keys(JSON.parse(borrowed)),
  ]
  // And the two tools every kind this app declares is worth (kinds.ts,
  // T-34513), beside whatever the manifest said: an app that declared a recipe
  // and no tool of its own still has a verb for putting one in and one for
  // finding it again, which is how the next agent discovers the app at all.
  let checked = withKinds(
    appTools(sent, words, vocabFile),
    manifest,
    `${space.slug}/${app.slug}`,
  )
  // What this release declares is now known, and nothing below changes it, so
  // it goes to the bucket while the seed, the commands and the worker are
  // staged: nothing selects it until `record` moves the pointers, and a write
  // to the bucket is most of a second (T-124005).
  let declare = c.time(
    'declare',
    () =>
      keepDeclaration(ctx.env, space, app, pointer, {
        vocab: JSON.parse(taken),
        tools: checked,
      }),
  )
  declare.catch(() => {})
  // Check the seed against the candidate words. The store applies it when the
  // directory moves the release pointer; until then the serving rows stay put.
  let sowed: Sown[] = []
  let seedTook = c.since()
  if (!app.seeded) {
    sowed = await sow(
      await texts(blobs, prefix, own(keys).filter(seedy)),
      applying(draft, await byCaller(ctx, who), '/seed'),
    )
  }
  seedTook('seed')
  let toolsTook = c.since()
  let tooled = JSON.parse(
    await answer(
      draft,
      '/tools',
      {
        method: 'POST',
        body: JSON.stringify(checked),
      },
      vouched(who),
    ),
  )
  let declared: string[] = tooled.tools ?? []
  // A view list that moved is news to every agent connected who can reach this
  // app (declared.ts, T-33004): a page a command draws its answer in is a
  // resource of theirs, and it appeared or went.
  //
  // The tool list is not news, because it did not move (T-34541): what this
  // deploy grew is a command inside `command`, and what a moved vocabulary
  // grew is graph_apply's schema, not its name. The roster is the same for
  // everybody and moves only when the platform is released (stream.ts).
  toolsTook('tools')
  let script = kept?.script ?? `app-${app.eid}-r-${crypto.randomUUID()}`
  let stagedApp = {
    ...app,
    source: release,
    script,
    lenses: latestSpeaks(dirPart.storeName(space, app), manifest, app.lenses),
  }
  let deployed = kept
    ? { ready: true, worker: kept.worker, lines: [] }
    : await c.time(
      'worker',
      () =>
        deployWorker(
          ctx.env,
          space,
          stagedApp,
          bytesAt,
          parsed,
          made.worker,
        ),
    )
  if (!deployed.ready) {
    throw refuse(
      'unavailable',
      `app_deploy did not deploy the worker: ${deployed.lines.join('; ')}`,
    )
  }
  let worker = deployed.worker
  let ran = [...made.lines, ...deployed.lines].map((line) => `\n${line}`)
    .join('')
  // What this release IS, kept so one word puts it back (T-32886): the files
  // as a manifest of path to the name of their bytes, those bytes pinned
  // beside them, and Cloudflare's name for the script this uploaded. The
  // app's live pointer and its move record commit together, once the
  // declaration and the release's index sent above have landed.
  let [, pinned] = await Promise.all([declare, snapshot])
  await c.time(
    'record',
    () =>
      record(
        ctx.dir,
        who,
        stagedApp,
        version,
        pinned,
        worker,
        staged,
        standing.source,
        standing.draft,
        fence,
        sowed.length > 0,
        reload,
        target,
        pointer,
      ),
  )
  // What follows a live release asks three different doors and none waits on
  // another: the store hears its release, connected agents hear a moved view
  // list, and the tracker closes what earlier versions broke.
  let after = <T>(work: () => Promise<T>) =>
    work().catch((e): undefined => {
      // The release is out; an open break is the softer wrong, and the tracker hears.
      try {
        caught(e, { tool: 'app_deploy', space: space.slug, app: app.slug })
      } catch { /* the release is already live */ }
    })
  // The view that follows a release is the person opening what they changed:
  // its files are asked for once now, so that view finds them cached
  // (files.ts `warm`). And the store tells the pages open on it that a
  // release went out; the answer says nothing that depends on either, so
  // nobody waits on them (T-124005).
  background(
    after(() => warm(ctx.env, app.eid, release, Object.keys(pinned)))
      .then(() => {}),
  )
  background(
    releaseNotice(store, version, {
      tool: 'app_deploy',
      space: space.slug,
      app: app.slug,
    }),
  )
  let [, closed = 0] = await Promise.all([
    tooled.views ? after(() => viewsMoved(ctx, space)) : null,
    // What the versions before this one broke is closed by this one: the code
    // that produced it is not what serves any more (unseen.ts `healed`,
    // D-32318 §Errors). The release already happened, so a store that cannot
    // be asked leaves the breaks open rather than failing a deploy that is
    // live.
    after(() =>
      c.time('healed', () => healed(ctx.env, space, app, who, version))
    ),
  ])
  // A published app's offer does not move with a deploy: publishing is the
  // owner's deliberate act and pins the version strangers install, so an
  // editor's deploy must not change what the whole platform gets. Silence
  // was the bug (T-33146) — installers kept taking v1 while v2 served and
  // nothing said so — and the fix is that the deploy door says it.
  let offer = app.published
  let trailing = offer && offer.version != version
    ? `\noffered as ${offer.name} is still v${offer.version}, so anyone ` +
      'installing it gets that code — app_publish again to offer this one'
    : ''
  let serves = parsed.config.assets?.directory
  return {
    version,
    serves,
    said: ran +
      trailing +
      servesSaid(serves) +
      (closed
        ? `\nclosed ${closed} ${
          closed == 1 ? 'break' : 'breaks'
        } from other versions`
        : '') +
      // What this app can now be asked to do, as `command` takes them: bare
      // names, because a command is said with its app beside it rather than
      // spliced into it (declared.ts, T-34541).
      (declared.length ? `\ncommands: ${declared.join(', ')}` : '') +
      (planted.length ? `\ncomponents: ${planted.join(', ')}` : '') +
      // The data the app came with, said once — the deploy after this one
      // finds the mark and seeds nothing.
      (sowed.length
        ? `\nseeded ${sowed.length} ${
          sowed.length == 1 ? 'entity' : 'entities'
        } from ${[...new Set(sowed.map((s) => s.file))].join(', ')}`
        : '') +
      // A word another app in the space already homes: this app writes it,
      // and the answer says where its rows land (T-32728).
      livesIn(uses).map((one) => `\n${one}`).join('') +
      (added.length ? `\nadded: ${added.join(', ')}` : '') +
      // What to DO about a property the manifest stopped naming, which the bare
      // list never said: the board that read "5.2 mi in null min" was a
      // rename nobody was told to finish (C-32730 item 4).
      // …named in the file the app actually wrote, since either format of
      // it is a manifest (`spelled` above, M-34605).
      (retained.length
        ? `\nkept, not in ${vocabFile} (the rows are there): ${
          retained.join(', ')
        } — name it in ${vocabFile} again to keep writing it, or move its ` +
          'rows to the new word yourself, a row at a time with graph_query ' +
          'then graph_apply. Nothing is migrated behind you; once no row ' +
          'holds a value under it, the next deploy drops it.'
        : '') +
      (dropped.length
        ? `\ndropped (nothing stored in it): ${dropped.join(', ')}`
        : ''),
  }
}

type DeployReview = {
  base: number
  version: number
  removed: string[]
  replaced: string[]
}

let released = async (
  ctx: Ctx,
  space: Space,
  app: App,
  who: Who,
  store: Door,
  {
    target,
    reload,
    preserve = false,
    accepted = [],
    base,
    confirm = false,
    expectedVersion,
  }: {
    target?: Version
    reload?: Reload
    preserve?: boolean
    accepted?: string[]
    base?: number
    confirm?: boolean
    expectedVersion?: number
  } = {},
): Promise<
  { version: number; said: string; serves?: string; review?: DeployReview }
> => {
  let c = ctx.clock ?? clock()
  let standing = await waiting(ctx.dir, space, app, who)
  if (expectedVersion != null && standing.version != expectedVersion) {
    throw refuse('stale', `v${expectedVersion} is no longer live`)
  }
  if (base != null && base > (standing.version ?? 0)) {
    throw refuse(
      'invalid',
      `base v${base} is ahead of live v${standing.version ?? 0}`,
    )
  }
  let blobs = r2RawObjects(ctx.env.BLOBS)
  let kept = target?.source && target.script ? target : undefined
  let release = kept?.source ?? releaseOf(space, standing)
  let draft = standing.draft ?? null
  let reviewing = base != null && base < (standing.version ?? 0) && !confirm
  let fence = await c.time('fence', () => fenced(ctx.dir, standing, draft, who))
  // The app's pages leave the edge as the release begins, beside its work
  // rather than after it: Site keeps none of a fenced app's pages
  // (page-cache.ts `keep`), so the commit purges nothing of the app's
  // (facets/pages-graph.ts), and the answer waits only on this. An app whose
  // pages Site never keeps has none to purge.
  let purged = reviewing || !keepable(standing) ? Promise.resolve() : purge(
    ctx.env,
    [appTag(standing.eid)],
  ).catch((e) =>
    caught(e, { request: 'release purge', space: space.slug, app: app.slug })
  )
  // A committed release clears the fence in its own record (versions.ts
  // `record`), so only a release that stopped short has one left to lift.
  let released = false
  try {
    // A deploy names the shas its draft holds, and a version put back that
    // kept no release names the shas its manifest does: neither reads or
    // copies a byte to make the release. The fence above holds edits off, so
    // the draft read here is the one this release takes.
    let files = kept
      ? {
        files: r2Objects(ctx.env.BLOBS),
        manifest: () => kept.files,
        finish: () => Promise.resolve(kept.files),
      }
      : staged(
        blobs,
        target ? target.files : (await c.time(
          'staged',
          () => drafting(blobs, ctx.dir, standing),
        )).files,
        release,
      )
    // The fence holds both the serving pointer and the candidate's edits.
    // Inspect losses before compiling, planting a schema or deploying a worker.
    if (reviewing && base != null) {
      let live = (await versions(ctx.dir, standing))
        .find((v) => v.version == standing.version)
      if (!live) throw refuse('missing', `no live v${standing.version}`)
      let candidate = files.manifest()
      if (!candidate) throw new Error('release has a file without a pinned sha')
      let paths = Object.keys(live.files).sort()
      return {
        version: standing.version!,
        said: '',
        review: {
          base,
          version: standing.version!,
          removed: paths.filter((path) => !(path in candidate)),
          replaced: paths.filter((path) =>
            path in candidate && candidate[path] != live.files[path]
          ),
        },
      }
    }
    let out = await published(
      ctx,
      space,
      { ...standing, draft },
      who,
      store,
      release,
      fence,
      files,
      target,
      reload,
      preserve,
      accepted,
    )
    released = true
    await c.time('purge', () => purged)
    return out
  } finally {
    if (!released) await unfenced(ctx.dir, standing, fence, who)
  }
}

/** Recover from the browser failure just accepted by the app_errors intake.
 * Intake is queued, so rereading the tracker here could miss that occurrence. */
export let recoverRelease = async (
  ctx: Ctx,
  space: Space,
  app: App,
  report: { version: number | null; message: string },
  request: string,
  mount: string,
) => {
  if (
    report.version == null ||
    !report.message.startsWith('failed to load script ')
  ) return
  let current = await ctx.dir.app(space, app.slug)
  if (
    !current || current.eid != app.eid || current.version != report.version ||
    current.fence
  ) return
  let all = await versions(ctx.dir, current)
  let live = all[0]
  if (!live || live.version != report.version) return
  let folder = live.source
    ? (await configOf(r2Objects(ctx.env.BLOBS), live.source)).assets?.directory
    : undefined
  let path = failedScript(report, live, request, mount, folder)
  if (!path) return
  let target = deployedOver(all, await ctx.dir.switches(current), live)
  if (!target) return
  let who: Who = { person: null, role: 'owner', administrative: true }
  await released(
    ctx,
    space,
    current,
    who,
    appStore(ctx.env.STORE, space, current, ctx.env),
    {
      target,
      expectedVersion: live.version,
    },
  )
  for (let person of await ctx.dir.owners(space)) {
    let data =
      `${space.slug}/${app.slug} automatically rolled back v${live.version} to v${target.version}: failed to load its own script ${path}`
    await notify(ctx.env, person, 'notifications/message', {
      level: 'warning',
      logger: `${space.slug}/${app.slug}`,
      data,
    }, data)
  }
}

// Select the publication, rather than whatever its publisher currently serves.
// Older versions without a release source still have their pinned file bytes.
let transferable = (path: string) =>
  !!own([path]).length || path.startsWith(BUILT)

let offered = async (ctx: Ctx, from: { space: Space; app: App }) => {
  let number = from.app.published!.version
  let version = (await ctx.dir.deploys(from.app)).find((v) =>
    v.version == number
  )
  if (!version) {
    throw refuse(
      'missing',
      `published version ${number} has no retained release`,
    )
  }
  let files = version.source
    ? await filesAt(r2RawObjects(ctx.env.BLOBS), version.source)
    : version.files
  return Object.fromEntries(
    Object.entries(files).filter(([path]) => transferable(path)),
  ) as Files
}

// A publication's source and completed build travel together, named by their
// shas, so an install copies no bytes. The copy earns its own history, and its
// uploaded blobs and store data stay its own.
let copied = async (
  ctx: Ctx,
  from: Files,
  onto: { space: Space; app: App },
  who: Who,
) =>
  (await modifying(
    r2RawObjects(ctx.env.BLOBS),
    ctx.dir,
    onto.space,
    onto.app,
    who,
    (draft) => {
      let gone = Object.keys(draft.files).filter((path) =>
        transferable(path) && !(path in from)
      )
      return Promise.resolve({
        changes: [
          ...Object.entries(from).map(([path, sha]) => ({ path, sha })),
          ...gone.map((path) => ({ path })),
        ],
        value: { wrote: own(Object.keys(from)), gone: own(gone) },
      })
    },
  )).value

let answer = (
  store: Door,
  path: string,
  init?: RequestInit | Request,
  headers?: Record<string, string>,
) =>
  store.consume(
    path,
    async (r) => {
      // A store refuses in JSON, and the caller hears its sentence.
      if (!r.ok) throw rejected(r.status, await sentence(r))
      return await r.text()
    },
    init,
    headers,
  )

// A file's key: its source prefix, then its app-relative path.
let fileKey = (space: Space, app: App, path: string) =>
  `${prefixOf(space, app)}/${path.replace(/^\/+/, '')}`

/**
 * Every file under one R2 prefix laid down under another, answering with the
 * old keys — which the caller sweeps once the directory write has landed. Copy
 * first and delete last is the order that matters: whichever address the app
 * answers at while the move is in flight has the whole app behind it, and a
 * move that dies halfway leaves the app whole at the address it started from.
 *
 * A file's key carries the space's slug and the app's, so both renames move
 * bytes: app_set moves one app's files, space_set moves every app's (T-34658).
 * Keying them by the app's handle instead would move none, and is the follow-up
 * this helper exists to make obvious.
 */
let laid = async (blobs: Objects, from: string, onto: string) => {
  let keys = await blobs.list(from)
  await Promise.all(keys.map(async (key) => {
    await blobs.put(onto + key.slice(from.length), await blobs.get(key))
  }))
  return keys
}

// ---- addresses left behind (T-34658, T-34659) -------------------------------
//
// An app and a space keep the same address history and change it in the same
// two ways, so the words and the arithmetic are here once rather than twice in
// two tools that would drift.

let FORGET = str(
  'a previous slug (not a URL) this has moved away from, to stop redirects ' +
    'and let it be taken again; never the current slug. Forgetting is final',
)

/** Whether an address is one this row has actually left. A refusal rather than
 * a shrug, because forgetting an address is the one thing here that breaks a
 * link somebody holds, and doing it to the wrong name is not a thing to guess
 * at. */
let forgotten = (live: string, had: string[], drop: string) => {
  if (drop == live) {
    throw refuse(
      'conflict',
      `${drop} is where it IS — move it first, and the address it leaves is ` +
        'the one there is to forget',
    )
  }
  if (!had.includes(drop)) {
    throw refuse(
      'missing',
      `${live} does not answer at ${drop}${
        had.length ? ` — it answers at ${had.join(', ')}` : ' any more'
      }`,
    )
  }
}

/** The address history this call leaves behind: the one it had, minus an
 * address forgotten, plus the address a move is leaving. Null when neither
 * happened, which is a call that must not write the property at all. */
let kept = (
  live: string,
  had: string[],
  moving: boolean,
  drop: string | null,
) => {
  if (!moving && drop == null) return null
  let now = drop == null ? had : had.filter((s) => s != drop)
  return moving && !now.includes(live) ? [...now, live] : now
}

/** What forgetting an address costs, said in what stops working. The whole
 * answer a person needs: the links are the thing they cannot get back. */
let lost = (address: string) =>
  `${address} stops redirecting and is free for anyone to take, so a link ` +
  'or a letter still aimed there now finds nothing'

/**
 * An app's row as it is born, at both doors that make one — app_new and
 * app_install. The eid is minted here rather than by a `$alias` the store
 * resolves, because the handle everything the platform keeps for this app is
 * named by is made out of it (directory.ts `handle`) and there is no second
 * moment to write it in. `former` opens at the slug it is born at: the first
 * line of an address history, which is all that word is now (T-34657).
 */
let born = (
  space: Space,
  slug: string,
  o: { title: string; access: Access },
): Bundle => {
  let eid = crypto.randomUUID()
  return {
    entity: { eid },
    doc: { title: o.title },
    app: {
      slug,
      space: space.eid,
      version: 0,
      access: o.access,
      store: handle(space, slug, eid),
    },
    former: { slug },
  }
}

/**
 * The manifest an app declares, as the bytes it is stored in, whichever
 * format it was written in: the `.yml` first — YAML is the warm path
 * (M-34605), and every parser here reads it through the same door as the
 * JSON (@yaks/yaml `read`) — then the `.json`, which every app that already
 * has one keeps. `file` is what a refusal calls it, and `source` is null where
 * the app declares no words, which is most apps. Beside them `pkg`, the
 * package.json whose `"platform"` dependencies lend the store their words
 * (vocab.ts `stated`). All are read at once, since each is a round trip to the
 * bucket.
 */
let declaring = async (
  blobs: Objects,
  space: Space,
  app: App,
): Promise<{ file: string; source: string | null; pkg: string | null }> => {
  let files = ['vocab.yml', 'vocab.json', 'package.json']
  let read = await Promise.all(
    files.map((file) => blobs.read(fileKey(space, app, file))),
  )
  let at = read.slice(0, 2).findIndex(Boolean)
  let pkg = read[2] ? decoded(read[2]) : null
  return at < 0
    ? { file: 'vocab.json', source: null, pkg }
    : { file: files[at], source: decoded(read[at]!), pkg }
}

// The words a publication declares, read from the bytes its vocab file names.
let offeredWords = async (raw: Objects, files: Files) => {
  let file = ['vocab.yml', 'vocab.json'].find((path) => path in files)
  let bytes = file ? await raw.read(addressed(files[file])) : null
  if (file && !bytes) throw refuse('missing', `no blob for ${files[file]}`)
  return { file: file ?? 'vocab.json', source: bytes ? decoded(bytes) : null }
}

// A file named as a picture is one, refused at the write with what is wrong
// and what to send instead, whichever door brought it (@yaks/blob `broken`). A
// chat model asked for a PNG transcribes one it cannot checksum, and kept as it
// came, that file served as the app's icon and drew nothing (T-123684).
let pictured = async (files: { path: string; bytes: Uint8Array }[]) => {
  for (let f of files) {
    let path = f.path.replace(/^\/+/, '')
    let why = await broken(f.bytes, mimeOf(path))
    if (why) {
      throw refuse(
        'arguments',
        `${path} does not decode: ${why}. ${instead(path)}`,
      )
    }
  }
}

// An icon.svg is drawn at the write too, since the app's icon is drawn from it
// (raster.ts), and one that cannot be is refused now rather than drawing
// nothing later. Its bytes are the write's own, or else the ones pinned at its
// sha by a write that learned where a file lands only after the bytes had gone
// (a drop takes a zip's shared folder off once the zip is read).
let iconed = async (env: Env, app: App, sent: Change[]) => {
  for (let f of sent) {
    if (f.path != ICON_SVG || !f.sha) continue
    let bytes = f.bytes ?? await r2RawObjects(env.BLOBS).get(addressed(f.sha))
    let drawing = await drawn(env, decoded(bytes), app.slug)
    if (typeof drawing == 'string') {
      throw refuse(
        'arguments',
        `${f.path} cannot be drawn as the app's icon: ${drawing}`,
      )
    }
  }
}

// What to send in place of a picture that does not decode.
let instead = (path: string) =>
  path == 'icon.png'
    ? `Write the icon as ${ICON_SVG} instead: a square SVG, sent as ` +
      'content, which the platform draws as icon.png'
    : mimeOf(path) == 'image/svg+xml'
    ? "Send the SVG's markup as content"
    : "Send the picture's own bytes (op: 'fetch' from its https URL, or " +
      'sandbox_ship from the sandbox), or draw it as an SVG sent as content'

/**
 * Bytes into the next release's private draft —
 * the write half of app_files, with no tool call in it, because bytes arrive
 * by other doors too: a zip somebody dropped on their space's page carries
 * pictures (drop.ts, T-34230), and `sandbox_ship` carries what a compiler
 * made (T-34264). Neither is `content: string` — a `.wasm` would not survive
 * a decode — which is why this takes bytes. Answers their app-relative paths,
 * and which of them the draft already held as sent (written.ts `modifying`),
 * so a write sent again after it was cut off says what had landed.
 *
 * Each file costs one put, at its content address, and the files go out at
 * once (T-34986); the draft records them in one directory write after (T-124791).
 * `files` is the wall clock of both.
 */
export let wroteAt = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  files: { path: string; bytes: Uint8Array }[],
  c: Clock = clock(),
) => {
  await c.time('pictures', () => pictured(files))
  return await wrotePinned(env, space, app, who, await hashed(files), c)
}

/**
 * Files named by their sha into the next release's private draft, each
 * carrying its bytes for the draft to put (`wroteAt`, once it has hashed them)
 * or already pinned (`pinning`). What turns on where a file lands is checked
 * here, by the path it lands at: the app's notes, the one file with a ceiling
 * of its own (standing.ts), handed whole to any agent that can reach the app,
 * so refused over the cap at the write rather than truncated at the read; and
 * an icon.svg, drawn. Then the space's room, then the draft.
 */
export let wrotePinned = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  sent: Change[],
  c: Clock = clock(),
) => {
  for (let f of sent) {
    let no = tooLong(f.path, f.size ?? 0)
    if (no) throw refuse('limit', no)
  }
  await c.time('icon', () => iconed(env, app, sent))
  let stopped = await c.time('quota', () => fullAt(env, space, sent))
  if (stopped) throw refuse('limit', stopped)
  let landing = await c.time(
    'files',
    () => drafted(env, space, app, who, sent),
  )
  return { ...landing, paths: sent.map((f) => f.path) }
}

/**
 * A stream's files pinned as they arrive (drop.ts): `pin` checks a file as
 * any write does, names it by its sha and puts it at its content address,
 * then answers once no more than `held` bytes wait on their puts, so however
 * long the stream, its files hold that much and the one in hand. A file
 * larger than `held` is put alone. `pinned` answers each file as a write
 * records it, bytes let go, once the last put is done, and `wrotePinned`
 * records them. A put that failed fails whichever of the two comes next.
 */
export let pinning = (blobs: Pick<Objects, 'put'>, held: number) => {
  let sent: Change[] = []
  let flying = new Set<Promise<void>>()
  let holding = 0
  let failed: { error: unknown } | null = null
  let fail = () => {
    if (failed) throw failed.error
  }
  return {
    pin: async (file: { path: string; bytes: Uint8Array }) => {
      fail()
      await pictured([file])
      let [{ bytes, ...f }] = await hashed([file])
      sent.push(f)
      holding += f.size
      let put: Promise<void> = blobs.put(addressed(f.sha), bytes)
        .catch((error) => void (failed ??= { error }))
        .finally(() => {
          holding -= f.size
          flying.delete(put)
        })
      flying.add(put)
      while (holding > held) await Promise.race(flying)
      fail()
    },
    pinned: async () => {
      await Promise.all(flying)
      fail()
      return sent
    },
  }
}

/** Files named by their sha, as a write records them. */
export let hashed = (files: { path: string; bytes: Uint8Array }[]) =>
  Promise.all(files.map(async (f) => ({
    path: f.path.replace(/^\/+/, ''),
    bytes: f.bytes,
    sha: await sha256(new Uint8Array(f.bytes)),
    size: f.bytes.byteLength,
  })))

/** Why the space has no room for what a write sends, or '' when it has. */
export let fullAt = (env: Env, space: Space, sent: Change[]) =>
  fullFiles(
    env,
    space,
    sent.flatMap((f) =>
      f.sha && f.size ? [{ key: addressed(f.sha), bytes: f.size }] : []
    ),
  )

export let wrote = async (...args: Parameters<typeof wroteAt>) =>
  (await wroteAt(...args)).paths

/**
 * Changes into an app's draft (written.ts `modifying`), with the wrangler
 * config the app serves by once they have landed, worked out beside them so
 * it adds no wait. Answers which paths the draft already held as sent.
 */
export let drafted = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  changes: Change[],
) => {
  let raw = r2RawObjects(env.BLOBS)
  let config: Promise<Config> = Promise.resolve({})
  let { already } = await modifying(
    raw,
    directory(bound(env.DIRECTORY, dirPart.fetch, env)),
    space,
    app,
    who,
    (draft) => {
      config = configAfter(raw, changes, draft)
      config.catch(() => {})
      return Promise.resolve({ changes, value: null })
    },
  )
  if (!who.administrative) scheduleUse(env, app.eid)
  return { config: await config, already }
}

/**
 * The wrangler config an app serves by once `changes` have landed: bytes the
 * call sent, else what the draft holds after it. The draft names its files,
 * so an app with no wrangler file costs no read at all.
 */
let configAfter = async (raw: Objects, changes: Change[], draft: Draft) => {
  let sent = new Map(changes.map((c) => [c.path, c.bytes]))
  let files = { ...draft.files }
  for (let c of changes) {
    if (c.sha) files[c.path] = c.sha
    else delete files[c.path]
  }
  let view = viewOf(raw, draft.root, files)
  return (await configured((p) =>
    sent.get(p)
      ? Promise.resolve(sent.get(p) as Uint8Array<ArrayBuffer>)
      : p in files
      ? view.read(`${draft.root}/${p}`)
      : Promise.resolve(null)
  )).config
}

/**
 * Delete each file under `folder` that `kept` does not name, into its own
 * history as app_files' delete does (written.ts): a build shipped over the
 * last one leaves none of the last one's files behind. Answers the paths it
 * deleted.
 */
let swept = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  folder: string,
  kept: string[],
) => {
  let keep = new Set(kept)
  return (await modifying(
    r2RawObjects(env.BLOBS),
    directory(bound(env.DIRECTORY, dirPart.fetch, env)),
    space,
    app,
    who,
    (draft) => {
      let gone = own(Object.keys(draft.files)).filter((path) =>
        path.startsWith(`${folder}/`) && !keep.has(path)
      )
      return Promise.resolve({
        changes: gone.map((path) => ({ path })),
        value: gone,
      })
    },
  )).value
}

/**
 * How big the bytes a path's history names are, as a history says it
 * ("4213 B, "): what the write that left them recorded, and where none did,
 * the bucket's word for one asked to `look`, else nothing.
 */
let sizes =
  (blobs: Objects, rows: Written[]) => async (sha: string, look = false) => {
    let n = rows.find((w) => w.sha == sha && w.size != null)?.size ??
      (look ? (await blobs.open(addressed(sha)))?.size : null)
    return n == null ? '' : `${size(n)}, `
  }

/**
 * What a write says about the bytes it stored: how many there are, their
 * sha256, for a `.json` file whether they parse, and for an icon.svg what it
 * becomes.
 *
 * A model writes a file by transcribing it, and a long one comes out with a
 * bracket run miscounted. Answering the measurement in the same call that
 * made the file means the mistake is caught where it was made, instead of
 * once the app is served broken (T-34337). The sha is what a second write
 * is compared against, and the byte count is what a hand-counted file is.
 */
export let stored = (path: string, bytes: Uint8Array, sha: string) =>
  `${bytes.byteLength} bytes, sha256 ${sha}` +
  (/\.(json|yml)$/.test(path) ? `, ${parses(path, bytes)}` : '') +
  (path == ICON_SVG
    ? ', drawn as the 512×512 icon.png a home screen shows, unless the app ' +
      'has an icon.png of its own'
    : '')

/**
 * Where a file answers once a write has landed, in a sentence: its address,
 * or that it is source only, when the app's wrangler `config` serves a folder
 * (files.ts `servedAt`).
 */
let placing = (ctx: Ctx, space: Space, app: App, config: Config) =>
  whereIn(url(space, app, ctx.env), config)

// A declaration file's verdict, in its own language: a `.json` through
// JSON.parse, whose error carries the position — "at position 45971" names the
// bracket, and nothing else in the answer could — and a `.yml` through the
// YAML door, whose error names the line.
export let parses = (path: string, bytes: Uint8Array) => {
  let text = decoded(bytes)
  let json = path.endsWith('.json')
  try {
    if (json) JSON.parse(text)
    else read(text, path)
    return 'parsed'
  } catch (e) {
    return `NOT valid ${json ? 'JSON' : 'YAML'} — ${(e as Error).message}`
  }
}

/**
 * A find-and-replace over one file's text: exact, and exactly once. Two
 * matches would edit a place nobody looked at and none would answer "wrote"
 * having changed nothing, so both refuse saying how many there were — which
 * is the number that tells the caller what to do next. The split-and-join is
 * not `String.replace`: a `$&` in the replacement is text here, not a
 * back-reference.
 */
export let patched = (
  was: string,
  find: string,
  replace: string,
  path: string,
) => {
  let parts = was.split(find)
  if (parts.length == 2) return parts.join(replace)
  let hits = parts.length - 1
  throw refuse(
    'arguments',
    `find matched ${hits} times in ${path} — a patch replaces exactly one` +
      (hits
        ? ': lengthen find until it names one place'
        : ': read the file back and copy the text exactly'),
  )
}

/**
 * A file off the web, for `op: fetch` to write into an app — so vendoring a
 * library is one call and not a transcription of minified code (T-34337).
 *
 * https only: an app is made of bytes somebody can vouch for.
 */
export let fetched = async (said: string) => {
  let at: URL
  try {
    at = new URL(said)
  } catch {
    throw refuse('arguments', `url: ${said} is not a URL`)
  }
  if (at.protocol != 'https:') {
    throw refuse(
      'arguments',
      `url: https only, not ${at.protocol.replace(':', '')}`,
    )
  }
  let r = await fetch(at)
  if (!r.ok) throw refuse('arguments', `${at} answered ${r.status}`)
  let bytes = new Uint8Array(await r.arrayBuffer())
  return {
    bytes,
    // What the response said it is, without its parameters. An app serves
    // the file by its path (files.ts mimeOf), so this is a fact about where
    // the bytes came from — and the sentence to read when a `.js` written to
    // a `.txt` path serves as text.
    mime: (r.headers.get('content-type') ?? '').split(';')[0].trim(),
  }
}

// The same digest a `<script integrity>` attribute wants: base64, not hex.
// So a page that goes on loading the file from a CDN can be pinned to the
// bytes this fetch actually got.
export let sri = (sha: string) =>
  btoa(String.fromCharCode(...sha.match(/../g)!.map((b) => parseInt(b, 16))))

/**
 * One of these tools, run as this caller. The drop door (drop.ts) is a page
 * doing what an agent does — make the app, write its files, release it — and
 * this is how it does exactly that rather than a second implementation of it:
 * every ceiling, guard and sentence is the tool's own.
 */
export let call = (ctx: Ctx, name: string, args: Args): Promise<Out> => {
  let tool = TOOLS.find((t) => t.name == name)
  if (!tool) throw new Error(`no tool ${name}`)
  return tool.run(ctx, args)
}

// ---- the workbench (sandbox.ts, T-34264) -----------------------------------

/**
 * One turn at the build session's workbench: the container, and the seconds
 * it cost.
 *
 * A build holds its own `spend` and pays for the whole thing when it ends,
 * destroying the container with it (builder.ts). A lone connector call arrives
 * with none, mints one, and pays for its own seconds here — leaving the
 * container to sleep on its own (sandbox.ts `SLEEP`), because the person may
 * well call again in a moment and a fresh container is a fresh `cargo build`.
 *
 * Two things are asked before the container is reached (T-37882, T-37883):
 * the month's sandbox seconds, the account's on a free space, with what this
 * build has held so far; and whether the caller already holds as many
 * sandboxes awake in other spaces as the plan allows.
 */
let bench = async <T>(
  ctx: Ctx,
  space: Space,
  body: (bench: Awaited<ReturnType<typeof workbench>>) => Promise<T>,
): Promise<T> => {
  let spend = ctx.spend ?? spending()
  let no = await refusedSpend(
    ctx.dir,
    space,
    'seconds',
    ctx.env,
    seconds(spend),
  )
  if (no) throw refuse('limit', no)
  await awake(ctx.env, space, ctx.person)
  let box = await workbench(ctx.env, space, ctx.person, spend)
  try {
    return await body(box)
  } finally {
    if (!ctx.spend) {
      await paid(spend, (s) => countedSpend(ctx.env, space, 0, s))
    }
  }
}

// What a tool hands back of a command's output. A compiler that failed says
// why in its first lines; past that it is the same warning again, and a model
// paying by the token should not read it twice.
let capped = (said: string) =>
  said.length > CAP
    ? `${said.slice(0, CAP)}\n… and ${said.length - CAP} more characters`
    : said

// The machine tools (@yaks/harness), declared there once and listed here as
// sandbox_<name>, run on this space's container (sandbox.ts
// `workbench`). The door adds the space to each one's arguments, says
// what each may do to the world, and caps what it hands back.
let HINTS: Record<
  string,
  Pick<Row, 'readOnly' | 'destructive' | 'idempotent' | 'openWorld' | 'slots'>
> = {
  // What a build may spend, out of the one place that decides it
  // (sandbox.ts BUDGET).
  shell: { destructive: true, openWorld: true, slots: { budget: `${BUDGET}` } },
  wait: { readOnly: true },
  stop: { destructive: true },
  read: { readOnly: true },
  // A path that already holds something is overwritten.
  write: { destructive: true, idempotent: true },
}

let SANDBOX: Row[] = machineDeclared().map((t) => {
  let shape = t.parameters as Omit<Shape, 'type'>
  return {
    ...HINTS[t.name],
    name: `sandbox_${t.name}`,
    input: {
      type: 'object',
      properties: { space: SPACE, ...shape.properties },
      required: shape.required,
    },
    run: async (ctx, args) => {
      let { space } = await inSpace(ctx, args, true)
      let said = await bench(
        ctx,
        space,
        async ({ machine }) =>
          await machineTools(machine, { cwd: () => CWD })
            .find((m) => m.name == t.name)!
            .run(args),
      )
      return { text: capped(said), space }
    },
  }
})

// What an app's access means where it is felt: what happens when the person
// sends someone the link. Said on every tool that sets it, so the agent can
// repeat it and the person is never surprised by who can act on their app.
let told = (access: Access) =>
  access == 'open'
    ? 'anyone with the link can use it, signed in or not'
    : access == 'private'
    ? 'only its members can see it; member_add mails an invitation to one'
    : 'anyone with the link can see it; only its members can change it'

// The inviter's own message, where they sent one (T-32963): a line or two
// saying what this is, carried at the top of the invitation. A paragraph, not
// a newsletter — an invitation mails an address the sender chose, so free text
// stays modest, and past the cap it is a refusal rather than a silent trim,
// which would send half a sentence in somebody's name. Control characters go
// because a letter is lines; markup cannot happen at all, since mail.ts
// escapes the whole body into the html part.
let NOTE = 500

let noteOf = (v: unknown) => {
  let said = text(v, 'note')
    // deno-lint-ignore no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .trim()
  if (said.length > NOTE) {
    throw refuse(
      'limit',
      `note: ${said.length} characters, and a note is at most ${NOTE} — ` +
        'a line or two saying what this is, not a newsletter',
    )
  }
  return said
}

// How many of these one person gets in an hour. A few is plenty: feedback is
// a person noticing something, not a stream, and the fourth in an hour is
// far likelier to be an agent in a loop than a fourth thing wrong.
let HOURLY = 3

// A caller who has not signed in has no identity to hand an allowance to, so
// theirs is per source instead (rate.ts `FEEDBACK_RATE`, one a minute): a
// stranger's report is wanted, a loop's is a mailbox full, and one stranger's
// loop must not silence every other stranger, which a shared count did.

// What this person has already said this hour, out of the meta store itself
// rather than a counter in some isolate — three per hour only means anything
// if it holds across the isolate a call lands in. A store that cannot answer
// counts nothing: a rate limit is never the reason feedback is lost.
let recently = async (ctx: Ctx) => {
  try {
    return (await meta(ctx.env).query(
      `.report&.created.by=${ctx.person}&.report.at>=1-hour-ago`,
    )).length
  } catch (e) {
    caught(e, { tool: 'feedback' })
    return 0
  }
}

// The type a view is served under: text/html with the profile the MCP Apps
// spec requires, which is how a host tells a page it renders from a page it
// merely reads. Only an app's own view wears it (declared.ts, T-32687): the
// platform draws nothing of its own.
export let VIEW_MIME = 'text/html;profile=mcp-app'

// The origins a view is allowed to reach, by what it reaches them for (MCP
// Apps §Resource _meta): `connectDomains` is fetch and websockets,
// `resourceDomains` is images, styles, scripts and fonts, `baseUriDomains` is
// what a `<base href>` may name. Anything not listed is refused by the host's
// own CSP, so an empty policy means a page that fetches nothing at all —
// which is a declaration, not a gap.
export type Csp = {
  connectDomains?: string[]
  resourceDomains?: string[]
  baseUriDomains?: string[]
}

// Resource metadata for both portable MCP Apps and ChatGPT.
// ui.domain is optional and host-specific: Claude expects a hashed hostname,
// while ChatGPT accepts a website origin. Do not copy the OpenAI value into
// the portable field. Other hosts choose their default sandbox origin.
// CSP still lists the actual network destinations; it does not set the
// sandbox origin. Include this metadata on resource listings and read contents.
// https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
// https://developers.openai.com/plugins/reference
export let uiMeta = (domain: string, csp: Csp = {}) => ({
  ui: { csp },
  'openai/widgetDomain': domain,
  'openai/widgetCSP': {
    connect_domains: csp.connectDomains ?? [],
    resource_domains: csp.resourceDomains ?? [],
  },
})

// A command's arguments as JSON Schema, as far as its signature reads them.
type Schema = {
  type?: unknown
  format?: unknown
  enum?: unknown[]
  items?: Schema
  properties?: Record<string, Schema>
  required?: string[]
  description?: unknown
}

// One command's arguments, as a signature a model reads: each in the order
// declared, `?` on one it may leave out, what it holds and, where the app
// said, what it is for. It is the JSON Schema `command` takes in `args`
// (@yaks/tools/declared `schemaOf`) said the short way, every fact of it,
// since some hosts show their model only the words; the schema rides in the
// answer's data too.
let argsOf = (input: unknown): string => {
  let s = (input ?? {}) as Schema
  let need = new Set(s.required ?? [])
  return Object.entries(s.properties ?? {}).map(([arg, a]) => {
    let what = holds(a)
    return `${arg}${need.has(arg) ? '' : '?'}${what && `: ${what}`}${
      a.description ? ` (${a.description})` : ''
    }`
  }).join(', ')
}

// What one argument holds: the values it may take, or its type with its
// format, what an array holds and an object's own fields.
let holds = (a: Schema): string =>
  a.enum ? a.enum.map((v) => JSON.stringify(v)).join(' | ') : [
    ...a.type == null ? [] : [[a.type].flat().join(' | ')],
    ...a.format == null ? [] : [String(a.format)],
    ...a.items ? [`of ${holds(a.items) || 'anything'}`] : [],
    ...a.properties ? [`{${argsOf(a)}}`] : [],
  ].join(' ')

/** Refused where the caller already owns as many free spaces as one person
 * gets (meter.ts `SPACES`, T-37882). A space in the trash is on its way out,
 * so it does not count; one somebody else made and invited them into is not
 * theirs, and one on the Plus plan is paid for on its own. */
let roomFor = async (ctx: Ctx) => {
  let held = (await ctx.dir.spaces(ctx.person, 'owner'))
    .filter((s) => free(s) && !s.trashed)
  if (held.length >= SPACES) {
    throw refuse('limit', tooManySpaces(held, ctx.env))
  }
}

// The pages the `guide` tool offers, said two ways: the names alone for the
// argument, and a name with its few words for the description, which is where
// an agent chooses one (guide.ts `brief`).
let SLUGS = PAGES.map((p) => p.slug).join(', ')
let COVERING = PAGES.map((p) => `${p.slug} (${p.brief})`).join(', ')

/** Someone in a space or an app, as app_list answers them (people.ts). */
type Someone = ReturnType<typeof shown>

/** One space as app_list answers it as data, `value.spaces`: everything the
 * listing knows, where its words say only what a person needs. `members`,
 * `invited`, `guests` are there only in a space the caller owns. */
export type Listed = {
  slug: string
  title: string
  url: string
  role: Role
  trashed: { days: number } | null
  apps: {
    slug: string
    title: string
    url: string
    mailbox: string
    version: number
    access: Access
    errors: number
    home: boolean
    usage: { requests: number; bytes: number } | null
    // Its share of what the space holds against `standing.limits.bytes` and
    // `.files`: its data and its photos and files (held.ts).
    held: Held
    bindings: {
      name: string
      type: string
      resource: string
      pending: boolean
    }[]
    guests?: Someone[]
    invited?: Someone[]
  }[]
  trash: { slug: string; title: string; days: number; held: Held }[]
  members?: Someone[]
  invited?: Someone[]
  standing: ReturnType<typeof standingOf>
}

// The platform's own rows. The roster every door serves is these plus what
// the plugins bring — `TOOLS`, at the foot of this file.
let OURS: Row[] = [
  {
    name: 'space_new',
    destructive: false,
    input: {
      type: 'object',
      properties: { slug: str('the hostname label'), title: str('its name') },
      required: ['slug', 'title'],
    },
    run: async (ctx, args) => {
      let s = fresh(args.slug, 'slug')
      // A grant narrowed to one space reaches that space and no other
      // (grants.ts `narrowed`), and a space it made would be a space outside
      // it. Said here because minting one is the single act that does not go
      // through the directory's membership at all.
      if (ctx.who?.space) {
        throw refuse(
          'access',
          `this grant reaches ${ctx.who.space} and no other space, so it ` +
            'cannot make one',
        )
      }
      let taken = await ctx.dir.space(s)
      if (taken) {
        // The slug is held for a trashed space for its whole thirty days
        // (erase.ts, T-34431), the way a trashed app's is: a second space
        // here is the one thing a restore could not put back. Only its own
        // owner is told that is why — to anybody else the address is taken,
        // which is all it ever was.
        let mine = taken.trashed &&
          await ctx.dir.role(taken, ctx.person) == 'owner'
        throw refuse(
          'conflict',
          mine
            ? `${s} is in the trash, ${
              daysLeft(taken.trashed!)
            } days left — space_restore(space: '${s}') brings it back whole, ` +
              'and after 30 days the platform erases it and frees the address'
            : `space ${s} is taken`,
        )
      }
      // An address a space has left still points at it (space_set below), so it
      // is not free for a new space either — the refusal app_new gives, one
      // level up.
      let was = await ctx.dir.formerly(s)
      if (was) {
        throw refuse(
          'conflict',
          `${s} is where ${was.slug} used to be, and still points there — ` +
            'pick another slug',
        )
      }
      await roomFor(ctx)
      // The space, its owner, and the owner's person row in one batch. The
      // person is keyed by the caller's sign-in, and a bundle mints at an eid
      // its author chose (T-32455), so the whole batch is bundles. Once
      // identity writes that row at sign-in (T-32327) it changes nothing and
      // apply drops it.
      await ctx.dir.apply({
        entities: [
          { entity: { eid: ctx.person }, person: {} },
          {
            entity: { eid: '$space' },
            doc: { title: titled(args.title) },
            space: { slug: s },
          },
          {
            entity: { eid: '$seat' },
            member: { space: '$space', person: ctx.person, role: 'owner' },
          },
        ],
      }, vouched(asCaller(ctx, 'owner')))
      let space = (await ctx.dir.space(s))!
      let at = `https://${spaceHost(ctx.env, s)}/`
      return {
        text: `space ${s} (${space.eid}): ${at}`,
        space,
        value: { eid: space.eid, url: at },
      }
    },
  },
  {
    name: 'space_set',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        slug: str('the new hostname label, to move the space'),
        title: str('the new name'),
        forget: FORGET,
      },
    },
    run: async (ctx, args) => {
      let { space, who } = await owns(ctx, args)
      let to = args.slug == null ? null : fresh(args.slug, 'slug')
      let title = args.title == null ? null : titled(args.title)
      let drop = args.forget == null ? null : slug(args.forget, 'forget')
      if (to == null && title == null && drop == null) {
        throw refuse(
          'arguments',
          'nothing to change: pass slug, title, or forget',
        )
      }
      let moving = to != null && to != space.slug
      if (drop != null) forgotten(space.slug, space.slugs, drop)
      // The meta space is the platform. A space in the trash, whose address
      // the trash holds, never gets here: `owns` refuses it.
      let no = refused(space, ctx.env)
      if (no) throw refuse('access', no)
      if (moving) {
        let taken = await ctx.dir.space(to!)
        if (taken) throw refuse('conflict', `space ${to} is taken`)
        let was = await ctx.dir.formerly(to!)
        if (was) {
          throw refuse(
            'conflict',
            `${to} is where ${was.slug} used to be, and still points there ` +
              '— pick another slug',
          )
        }
      }
      // The address it leaves keeps answering, as a permanent redirect to the
      // new subdomain with the path kept (apps.ts `served`), and letters to
      // `<was>.<app>@yaks.app` still arrive (inbox.ts `opened`). A link
      // someone was given is forever, and a space's address is on more of
      // them than an app's — until the person says to forget one.
      let had = kept(space.slug, space.slugs, moving, drop)
      // Every app's files move with the space, because a file's key carries
      // the space's slug (`laid`). Copied before anything is deleted, so the
      // apps are whole at whichever address answers while the move is in
      // flight. Nothing else moves: the store handles are the apps' own
      // (directory.ts `handle`), a custom domain names an eid, and
      // memberships, grants, gallery standing and analytics never held the
      // slug at all.
      let apps = moving ? await ctx.dir.apps(space) : []
      let blobs = r2Objects(ctx.env.BLOBS)
      let keys: string[] = []
      for (let app of apps) {
        keys.push(
          ...await laid(
            blobs,
            `${space.slug}/${app.slug}/`,
            `${to}/${app.slug}/`,
          ),
        )
        keys.push(
          ...await laid(
            blobs,
            `${space.slug}/.releases/${app.eid}/`,
            `${to}/.releases/${app.eid}/`,
          ),
        )
        keys.push(
          ...await laid(
            blobs,
            `${space.slug}/.declarations/${app.eid}/`,
            `${to}/.declarations/${app.eid}/`,
          ),
        )
      }
      let entities: Bundle[] = [{
        entity: { eid: space.eid },
        ...(title == null ? {} : { doc: { title } }),
        ...(moving ? { space: { slug: to! } } : {}),
        ...(had ? { former: addresses(had) } : {}),
      }]
      if (moving) {
        entities.push(
          // A draft is rows (written.ts), named by no address.
          ...apps.filter((app) => app.source).map((app) => ({
            entity: { eid: app.eid },
            app: { source: app.source!.replace(`${space.slug}/`, `${to}/`) },
          })),
        )
      }
      await (entities.length > 1 ? ctx.dir.stamp : ctx.dir.apply)(
        { entities },
        vouched(who),
      )
      await blobs.delete(keys)
      let now = (await ctx.dir.space(to ?? space.slug))!
      return {
        text: `space ${now.slug}${title == null ? '' : ` "${title}"`}: ` +
          `https://${spaceHost(ctx.env, now.slug)}/` +
          (moving
            ? ` — moved from ${
              spaceHost(ctx.env, space.slug)
            }, which redirects here ` +
              `and stays reserved; letters to ${
                mailFrom(space.slug, '<app>', ctx.env)
              } still arrive. Give people the new address` +
              (apps.length
                ? `, and every app of the space moved with it (${
                  apps.map((a) => a.slug).join(', ')
                })`
                : '')
            : '') +
          (drop == null ? '' : ` — ${lost(`${spaceHost(ctx.env, drop)}`)}`),
        space: now,
      }
    },
  },
  {
    name: 'space_delete',
    destructive: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        forever: {
          type: 'boolean',
          description:
            'true to email a link that erases the space at once instead ' +
            'of trashing it: its apps, everything they saved, their files ' +
            'and its address, all gone, with no restore',
        },
      },
      required: ['space'],
    },
    run: async (ctx, args) => {
      // Naming the space is required here and optional everywhere else: a
      // tool that guesses which space to destroy from context is a tool that
      // one day guesses wrong (`ownSpace`), and it costs the agent one word
      // it already knows.
      let { space, who } = owner(
        await spaceBin(ctx, { ...args, space: slug(args.space, 'space') }),
      )
      let no = refused(space, ctx.env)
      if (no) throw refuse('access', no)
      let forever = args.forever != null && flag(args.forever, 'forever')
      if (space.trashed && !forever) {
        throw refuse(
          'conflict',
          `${space.slug} is already in the trash, ${
            daysLeft(space.trashed)
          } days left — space_restore(space: '${space.slug}') brings it back, ` +
            'or space_delete(forever: true) mails a link that erases it now',
        )
      }
      let d = await doomed(ctx.dir, space)
      if (await nobodys(ctx.dir, d)) {
        if (forever) {
          let out = await erase(ctx.env, ctx.dir, d, who)
          return { text: went(d, out, ctx.env) }
        }
        await trashSpace(ctx.env, ctx.dir, space, who)
        // The answer's unseen rider must see the committed trash mark rather
        // than ask a store that the notification just made dormant.
        return {
          text: inTrash(d, ctx.env),
          space: (await ctx.dir.space(space.slug))!,
        }
      }
      if (!ctx.env.SESSION_SECRET) {
        throw new Error('the platform cannot sign a confirmation link here')
      }
      // Where the letter goes: the address this caller signs in with, which
      // is an owner's — never one the agent named, so nothing an agent says
      // can point this letter at somebody else.
      let to = await ctx.dir.emailAt(ctx.person)
      if (!to) throw refuse('missing', 'we have no address to write to you at')
      // What the link would do, in the words of the act it carries: `forever`
      // names what is destroyed, the trash names what stops (erase.ts).
      let bullets = (lines: string[]) => lines.map((l) => `  - ${l}`).join('\n')
      let said = bullets(forever ? naming(d, ctx.env) : keeping(d, ctx.env))
      let link = door(
        space.slug,
        await ticket(space, ctx.person, ctx.env.SESSION_SECRET, forever),
        ctx.env,
      )
      // A letter that will not send is not a link to hand over (member_add
      // does that for an invitation, which is not an irreversible act): the
      // web door is said instead, and it still wants their cookie, their
      // ownership and the name typed back. That door trashes whatever was
      // asked for here — the erase rides in the ticket, and the ticket was in
      // the letter that did not arrive — so what it would do is said in the
      // trash's words however this call was made.
      try {
        await mail(ctx.env)({ to, ...letter(d, link, forever, ctx.env) })
      } catch (e) {
        throw new Error(
          'the confirmation letter could not be sent. They can still put the ' +
            `space in the trash themselves, signed in, at ${
              door(space.slug, undefined, ctx.env)
            } — which asks them to type ${space.slug} back. That would stop:\n` +
            bullets(keeping(d, ctx.env)),
          { cause: e },
        )
      }
      return {
        text: `nothing is deleted. ${space.slug} is still there, and an ` +
          'assistant cannot delete a space: a letter is on its way to the ' +
          'address they sign in with, carrying a link that does it. It ' +
          'lasts an hour, and opening it asks them once more. Tell them to ' +
          `check their email. What it would ${
            forever ? 'destroy' : 'stop, until they restore it'
          }:\n${said}`,
        space,
      }
    },
  },
  {
    name: 'space_restore',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: { space: SPACE },
      required: ['space'],
    },
    run: async (ctx, args) => {
      let { space, who } = owner(
        await spaceBin(ctx, { ...args, space: slug(args.space, 'space') }),
      )
      if (!space.trashed) {
        throw refuse(
          'conflict',
          `${space.slug} is not in the trash — it is serving at ` +
            `https://${spaceHost(ctx.env, space.slug)}/`,
        )
      }
      if (free(space)) await roomFor(ctx)
      await untrashSpace(ctx.env, ctx.dir, space, who)
      return {
        text:
          `${space.slug} is back: https://${
            spaceHost(ctx.env, space.slug)
          }/ serves ` +
          'again and its apps are yours again. Everything they saved is ' +
          'where it was.',
        space: (await ctx.dir.space(space.slug))!,
      }
    },
  },
  {
    name: 'space_sell',
    destructive: false,
    // Asked again, it converges on the same connected account (sell.ts).
    idempotent: true,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        disconnect: {
          type: 'boolean',
          description:
            'true to stop selling through this space: the Stripe account is ' +
            'left untouched, and no app here can charge on it any more. ' +
            'Connecting again is one call',
        },
      },
    },
    run: async (ctx, args) => {
      let { space } = await owns(ctx, args)
      if (args.disconnect != null && flag(args.disconnect, 'disconnect')) {
        if (!space.stripe?.account) {
          throw refuse(
            'conflict',
            `${space.slug} is not selling through Stripe`,
          )
        }
        await disconnect(ctx.env, space)
        return {
          text: `${space.slug} has stopped selling. Their Stripe account is ` +
            'untouched — their money, their records, their dashboard, all ' +
            'exactly where they were — and nothing here can charge on it now.',
          space,
        }
      }
      if (!ctx.env.STRIPE_KEY) {
        throw refuse('unavailable', 'selling is not switched on here')
      }
      let no = refusedSell(space, ctx.env)
      if (no) throw refuse('limit', no)
      if (selling(space) == 'ready') {
        return {
          text: `${space.slug} is already selling: Stripe has them ready to ` +
            `take payments, and every app here can charge through POST ` +
            `/api/pay/checkout. We take ${rate(await feeOf(ctx.dir))} of ` +
            `each sale.`,
          space,
        }
      }
      // The address the platform already has for them, so Stripe's form opens
      // with it filled in. Never one the agent named — the account is minted
      // against the person who is signed in, and an address an agent chose
      // would be an account onboarded to somebody else.
      let email = await ctx.dir.emailAt(ctx.person) ?? ''
      let made = await connect(ctx.env, space, email)
      return {
        text:
          `Send them this link to finish setting up with Stripe — it is theirs ` +
          `alone, it is good once, and it expires:\n\n${made.url}\n\nNothing ` +
          `can be sold in ${space.slug} until they have been through it. They ` +
          `are the merchant: their charge, their money, their name on the ` +
          `statement, and refunds and disputes are theirs. We take ` +
          `${rate(await feeOf(ctx.dir))} ` +
          `of each sale. Call space_sell again for a fresh link — it opens the ` +
          `same Stripe account, never a second one.`,
        space,
      }
    },
  },
  {
    name: 'app_new',
    destructive: false,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        slug: str('the app slug: the short URL path segment, e.g. recipes'),
        title: str('its name'),
        access: ACCESS,
      },
      required: ['slug', 'title'],
    },
    run: async (ctx, args) => {
      let { space, who } = await inSpace(ctx, args, true)
      let s = fresh(args.slug, 'slug')
      // The plan's app ceiling (T-32758), at the one door that adds one.
      // An app costs money to keep, so this is a refusal and not a warning —
      // the warning came at 80%, on the unseen channel (unseen.ts `ceiling`).
      let free = ceilings(space.tier, space.slug)
      // What the space has: an app in the trash is one the person has already
      // said they are done with, so it stands against nothing (erase.ts).
      let apps = (await ctx.dir.apps(space)).filter((a) => !a.trashed)
      if (free?.apps != null && apps.length >= free.apps) {
        throw refuse('limit', atCeiling(space, 'apps', ctx.env))
      }
      let taken = await ctx.dir.app(space, s)
      if (taken) {
        // The slug is held for a trashed app for its whole thirty days
        // (erase.ts): a second app born here is the one thing a restore
        // could not put back, so this address is not free until the person
        // says which of the two they want.
        throw refuse(
          'conflict',
          taken.trashed
            ? `${s} is in the trash in ${space.slug}, ${
              daysLeft(taken.trashed)
            } days left — app_restore(app: '${s}') brings it back, or ` +
              `app_delete(app: '${s}', forever: true) erases it and frees ` +
              'the address'
            : `app ${s} exists in ${space.slug}`,
        )
      }
      // An address an app has left still points at it (app_set below), so it
      // is not free for a new app either.
      let moved = await ctx.dir.former(space, s)
      if (moved) {
        throw refuse(
          'conflict',
          `${s} is where ${space.slug}/${moved.slug} used to be, and still ` +
            'points there — pick another slug',
        )
      }
      let entities: Bundle[] = [born(space, s, {
        title: titled(args.title),
        access: args.access == null ? 'public' : access(args.access),
      })]
      // Being first claims nothing (T-33040). Until somebody says which app
      // is the front page, the space's bare hostname lists the apps its
      // visitor may open; which app opens there is a choice, and arrival
      // order is not a choice anyone made. Said in the answer, because
      // nothing else tells a person the front page is theirs to set.
      let front = await ctx.dir.home(space)
      await ctx.dir.apply({ entities }, vouched(who))
      let app = (await ctx.dir.app(space, s))!
      let at = url(space, app, ctx.env)
      return {
        text: `app ${space.slug}/${s} (${app.eid}): ${at}` +
          ` — ${told(app.access)}. https://${spaceHost(ctx.env, space.slug)}/ ${
            front ? `opens ${front.slug}` : "lists the space's apps"
          } — app_set(app, home: true) makes this one the front page there`,
        space,
        value: { eid: app.eid, url: at },
      }
    },
  },
  {
    name: 'app_files',
    destructive: true,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        op: {
          type: 'string',
          enum: [...OPS],
          description:
            'list, read, write, patch, fetch, delete, history or restore. Required ' +
            'unless files, content or base64 supplies a write',
        },
        path: str('path relative to the app root, e.g. index.html'),
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'for read: several paths answered in one call, each ' +
            'with its SHA-256. With neither path nor paths, read answers ' +
            'every text file in the app',
        },
        content: str('the file text, for write'),
        base64: str(
          'the file bytes, base64-encoded, instead of content: for a file ' +
            'that is not text, such as the .wasm a worker.js imports',
        ),
        find: str(
          'for patch: the exact text to replace, which must appear exactly ' +
            'once in the file',
        ),
        replace: str(
          'for patch: what goes in its place; the empty string removes the ' +
            'text',
        ),
        url: str(
          'for fetch: the https URL whose response body is written to ' +
            'path, which vendors a library into the app without transcribing ' +
            'it',
        ),
        sha: str(
          'for restore: the SHA-256 content hash of the version to put back, from op ' +
            'history. With both sha and at left out, the newest is put back',
        ),
        at: str(
          'for restore: put the file back to what it was at this moment, ' +
            'e.g. 2026-09-06T14:20:00Z',
        ),
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: str('path relative to the app root'),
              content: str('the file text'),
              base64: str('the file bytes, base64, instead of content'),
            },
            required: ['path'],
          },
          description: 'several files to write at once, instead of ' +
            'path and content: the whole app in one call',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let batch = files(args.files)
      let op = opOf(args, batch.length)
      // The refusal names the ops and the batch, because a bare "op is
      // required" leaves an agent guessing at both (C-32624 item 5).
      if (!OPS.includes(op)) {
        throw refuse(
          'arguments',
          `op: one of ${OPS.join(', ')} — write takes path and content, or ` +
            'files: [{path, content}] for several at once',
        )
      }
      let c = ctx.clock ?? clock()
      let { space, app, who } = await c.time(
        'inApp',
        () => inApp(ctx, args, WRITES.includes(op)),
      )
      let blobs = r2RawObjects(ctx.env.BLOBS)
      // A path as the app names it: written.ts keys the draft by app-relative
      // paths, and a leading slash names the same file.
      let named = (path: string) => path.replace(/^\/+/, '')
      // The draft names every file it holds by sha (written.ts), so listing,
      // comparing and finding a file read no bytes; only a file asked for
      // whole is read, from its content address.
      let draft = () => c.time('draft', () => drafting(blobs, ctx.dir, app))
      let at = (d: Draft, path: string) => `${d.root}/${path}`
      if (op == 'list') {
        let [d, all] = await Promise.all([draft(), versions(ctx.dir, app)])
        let live = all.find((v) => v.version == app.version)
        let files: Files = Object.fromEntries(
          Object.entries(d.files).filter(([path]) => own([path]).length),
        )
        let paths = Object.keys(files).sort()
        let unreleased = !live || !same(live.files, files)
        let version = app.version ?? 0
        let { config } = await configured((p) =>
          p in files ? d.view.read(at(d, p)) : Promise.resolve(null)
        )
        let { dir, source } = sourceOnly(config, paths)
        // Every fact in the value said in the words too: claude.ai's model
        // reads only the words, and app_deploy's base is this version.
        return {
          text: [
            ...paths.length
              ? paths.map((path) => `${path} — sha256 ${files[path]}`)
              : ['(no files)'],
            ...dir
              ? [
                `The app serves ${dir}/; these are source only, not on the ` +
                `web: ${source.join(', ') || '(none)'}`,
              ]
              : [],
            !live
              ? 'Nothing is released yet.'
              : unreleased
              ? `The draft differs from live v${version}; ` +
                `app_deploy(base: ${version}) releases it.`
              : `These are live v${version}, with nothing unreleased.`,
          ].join('\n'),
          space,
          value: {
            files: paths.map((path) => ({ path, sha: files[path] })),
            unreleased,
            version,
            ...dir && { serves: dir, sourceOnly: source },
          },
        }
      }
      // One path is that file whole, as its text. Several, or none, is the
      // app read back in one call (files_read.ts): what an assistant coming
      // back to an app needs before it changes anything (T-124200).
      if (op == 'read' && args.path != null && args.paths == null) {
        let d = await draft()
        let bytes = await d.view.read(at(d, named(text(args.path, 'path'))))
        if (!bytes) throw refuse('missing', `no file ${args.path}`)
        return {
          text: decoded(bytes),
          space,
          value: { version: app.version ?? 0 },
        }
      }
      if (op == 'read') {
        let d = await draft()
        let asked = [...list(args.path, 'path'), ...list(args.paths, 'paths')]
          .map(named)
        let paths = asked.length ? asked : own(Object.keys(d.files)).sort()
        let read = await peruse(paths, (path) => d.view.open(at(d, path)))
        let version = app.version ?? 0
        return {
          text: perusal(read, version),
          space,
          value: {
            files: read.files.map(({ path, sha, size }) => ({
              path,
              sha,
              size,
            })),
            unread: read.unread,
            version,
          },
        }
      }
      if (op == 'delete') {
        let path = named(text(args.path, 'path'))
        // A delete takes bytes away like a write does, so it keeps them the
        // same way: the file's last write stays in its history the moment it
        // stops being a file, and op restore brings it back (T-34508). One
        // sent again after it landed finds the draft's own delete and says so.
        let { value: gone } = await modifying(
          blobs,
          ctx.dir,
          space,
          app,
          who,
          (d, _app, attempt) => Promise.resolve(deleting(d, path, attempt)),
        )
        if (!who.administrative) scheduleUse(ctx.env, app.eid)
        return {
          text: `${gone ? 'deleted' : 'already deleted'} ${path} — ` +
            `app_files(app: '${app.slug}', op: 'restore', path: '${path}') ` +
            'brings it back; staged for app_deploy',
          space,
        }
      }
      // What this file has been (T-34508): what each write to it the app
      // keeps took away, newest first, each a sha whose bytes are still
      // stored. `now` is at the top because "what is there this second" is
      // half of what somebody reading a history is trying to work out.
      if (op == 'history') {
        let path = named(text(args.path, 'path'))
        let [d, all] = await Promise.all([draft(), history(ctx.dir, app, path)])
        let now = d.files[path] ?? null
        let gone = replaced(all)
        let sized = sizes(blobs, all)
        let name = async (by: string | null) =>
          (by && await ctx.dir.nameAt(by)) || by || 'someone'
        return {
          text: [
            `${path} in ${space.slug}/${app.slug}:`,
            now
              ? `now — ${await sized(now, true)}sha256 ${now}`
              : 'now — no file there',
            ...await Promise.all(
              gone.map(async (w) =>
                `- until ${w.at} — ${await sized(
                  w.sha,
                )}sha256 ${w.sha}, by ${await name(w.by)}`
              ),
            ),
            gone.length
              ? `app_files(app: '${app.slug}', op: 'restore', path: ` +
                `'${path}') puts back the newest of those; sha or at names ` +
                'another'
              : 'Nothing has replaced it, so there is nothing to put back.',
          ].join('\n'),
          space,
        }
      }
      // And putting one back, as a new write naming the sha it held, so what
      // it replaces is kept in turn and a restore can be undone by another.
      // No bytes move: they are already at their address.
      if (op == 'restore') {
        let path = named(text(args.path, 'path'))
        let [d, all] = await Promise.all([draft(), history(ctx.dir, app, path)])
        let now = d.files[path] ?? null
        let gone = replaced(all)
        if (!all.length) {
          throw refuse(
            'missing',
            `no history for ${path} in ${space.slug}/${app.slug} — nothing ` +
              'has replaced it, so what is there is what there has been',
          )
        }
        let { then, want } = restoring(all, now, {
          ...args.at != null ? { at: when(text(args.at, 'at')).getTime() } : {},
          ...args.sha != null ? { sha: text(args.sha, 'sha') } : {},
        })
        if (!want) {
          throw refuse(
            'missing',
            args.sha != null
              ? `no ${args.sha} in ${path}'s history — op history lists what ` +
                'it keeps'
              : args.at != null && then === undefined
              ? `${path} has not been written since ${args.at}, so what is ` +
                'there is already what it was then'
              : args.at != null
              ? `there was no file at ${path} at ${args.at} — op delete ` +
                'removes it'
              : `nothing has replaced ${path} in ${space.slug}/` +
                `${app.slug}, so what is there is what there has been`,
          )
        }
        if (!await blobs.has(addressed(want))) {
          throw refuse(
            'missing',
            `${path}'s bytes ${want} are no longer kept — the history goes ` +
              'back 30 days',
          )
        }
        let until = gone.find((w) => w.sha == want)?.at
        let { config } = await drafted(ctx.env, space, app, who, [{
          path,
          sha: want,
          size: all.find((w) => w.sha == want)?.size ?? null,
        }])
        let where = placing(ctx, space, app, config)
        return {
          text:
            `put ${path} back to ${
              until ? `what it was until ${until}` : `sha256 ${want}`
            } → ${
              where(path)
            }, sha256 ${want}. This is itself a write, so op ` +
            'history now has the bytes it replaced. Staged for app_deploy.',
          space,
        }
      }
      // A read-modify-write of one file, in one call: the loop an agent that
      // miscounted a bracket in a 46 KB file had no cheap way to run.
      if (op == 'patch') {
        let path = named(text(args.path, 'path'))
        let d = await draft()
        let was = await d.view.read(at(d, path))
        if (!was) throw refuse('missing', `no file ${path}`)
        // Empty is a legal replacement — it is how a line is removed — so
        // this asks for a string rather than for something.
        if (typeof args.replace != 'string') {
          throw refuse(
            'arguments',
            'replace is required (the empty string removes)',
          )
        }
        let now = new TextEncoder().encode(patched(
          decoded(was),
          text(args.find, 'find'),
          args.replace,
          path,
        ))
        let { paths: [p], config } = await wroteAt(
          ctx.env,
          space,
          app,
          who,
          [{ path, bytes: now }],
          c,
        )
        let where = placing(ctx, space, app, config)
        return {
          text: `patched ${p} → ${where(p)} — ${
            stored(p, now, await sha256(now))
          }; staged for app_deploy`,
          space,
        }
      }
      // A library vendored, rather than a minified file transcribed by hand.
      if (op == 'fetch') {
        let path = text(args.path, 'path')
        let got = await c.time('fetch', () => fetched(text(args.url, 'url')))
        let { paths: [p], config } = await wroteAt(
          ctx.env,
          space,
          app,
          who,
          [{ path, bytes: got.bytes }],
          c,
        )
        let sha = await sha256(got.bytes)
        let where = placing(ctx, space, app, config)
        return {
          // The integrity hash so a page that goes on loading this from a
          // CDN can be pinned to the very bytes we got; the mime is what the
          // response claimed, and mimeOf(path) is what the app will serve.
          text:
            `fetched ${args.url} → ${where(p)} — ${stored(p, got.bytes, sha)}${
              got.mime ? `, ${got.mime}` : ''
            }, integrity sha256-${sri(sha)}` +
            (mimeOf(p) == 'application/octet-stream'
              ? ' — the app serves it as application/octet-stream; give the ' +
                'path a known extension to serve it as anything else'
              : '') +
            '; staged for app_deploy',
          space,
        }
      }
      let sent = batch.length ? batch : [{
        path: text(args.path, 'path'),
        bytes: bytesOf(args),
      }]
      let { paths, config, already } = await wroteAt(
        ctx.env,
        space,
        app,
        who,
        sent,
        c,
      )
      // What landed, per file: the measurement the caller checks its own
      // transcription against. A file the draft already held as sent was not
      // sent again, so a write cut off and sent again says what had landed.
      let there = new Set(already)
      let each = await Promise.all(
        sent.map(async (f, i) =>
          stored(paths[i], f.bytes, await sha256(f.bytes)) +
          (there.has(paths[i]) ? ', already there' : '')
        ),
      )
      let where = placing(ctx, space, app, config)
      return {
        text: paths.length == 1
          ? `${there.size ? 'already had' : 'wrote'} ${paths[0]} → ${
            where(paths[0])
          } — ${each[0]}; staged for app_deploy`
          : `wrote ${
            there.size ? `${paths.length - there.size} of ` : ''
          }${paths.length} files → ${url(space, app, ctx.env)}` +
            (there.size
              ? ` (the draft already held ${there.size} of them as sent)`
              : '') +
            ':\n' +
            paths.map((p, i) =>
              `${p}${where.dir ? ` → ${where(p)}` : ''} — ${each[i]}`
            ).join('\n') +
            '\nStaged for app_deploy.',
        space,
        value: { wrote: paths.filter((p) => !there.has(p)), already },
      }
    },
  },
  // The workbench (sandbox.ts, T-34264): the machine tools, and shipping
  // what they built. They are here rather than in a tier of their own because
  // they are the platform's verbs like the rest: an owner or editor of the
  // space calls them, the builder we run calls them through the same table
  // (builder.ts `roster`), and a person's own agent calls them over the
  // connector.
  ...SANDBOX,
  {
    name: 'sandbox_ship',
    destructive: true,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        paths: {
          type: 'array',
          items: str(
            'a file, folder or glob in the sandbox, e.g. dist or ' +
              'pkg/*.wasm',
          ),
          description: 'what to copy into the app: a folder copies the ' +
            'files inside it, and a file or glob match lands under its own ' +
            'name, keeping the folders below the one its matches share',
        },
        into: str(
          'a folder of the app to copy into, e.g. dist; left out, the ' +
            'files land at the app root',
        ),
        replace: {
          type: 'boolean',
          description: 'with into: the folder then holds exactly what this ' +
            'ships, and each file in it the build no longer makes is ' +
            "deleted (kept in its history), so an earlier build's hashed " +
            'files do not pile up',
        },
      },
      required: ['app', 'paths'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args, true)
      let asked = list(args.paths, 'paths').map(sandboxPath)
      if (!asked.length) {
        throw refuse('arguments', 'paths: at least one file to copy in')
      }
      let into = args.into == null ? '' : appFolder(text(args.into, 'into'))
      let replace = args.replace === true
      if (replace && !into) {
        throw refuse(
          'arguments',
          'replace: needs into, the folder of the app the build replaces',
        )
      }
      let files = await bench(ctx, space, async ({ provider, ref }) => {
        // One listing expands every glob and walks every folder at once, so
        // a whole build costs one command rather than one per path.
        let found = await provider.exec(ref, listing(asked))
        let landings = landed(asked, found.stdout, into)
        if (!landings.length) {
          throw refuse(
            'missing',
            `nothing in the sandbox matches ${asked.join(', ')} — ` +
              'sandbox_shell `ls` to see what the build left',
          )
        }
        // A file two paths both named is read once and lands at each.
        let to = Map.groupBy(landings, (l) => l.from)
        let files = []
        for await (let file of provider.export(ref, [...to.keys()])) {
          for (let l of to.get(file.path) ?? []) {
            files.push({ path: l.to, bytes: file.bytes })
          }
        }
        return files
      })
      let { paths, already } = await wroteAt(ctx.env, space, app, who, files)
      let gone = replace
        ? await swept(ctx.env, space, app, who, into, paths)
        : []
      // A ship cut off and sent again puts up only what had not landed, and
      // says so.
      return {
        text: `shipped ${paths.length} ${
          paths.length == 1 ? 'file' : 'files'
        } → ${url(space, app, ctx.env)}: ${capped(paths.join(', '))}${
          already.length
            ? `; ${already.length} of them the draft already held as built, ` +
              `so they did not go up again: ${capped(already.join(', '))}`
            : ''
        }${
          gone.length
            ? `; deleted ${gone.length} the build no longer makes: ${
              capped(gone.join(', '))
            }`
            : ''
        }; staged for app_deploy`,
        space,
      }
    },
  },
  {
    name: 'app_deploy',
    // The two examples the code owns, said in its words (tools.yml
    // `app_deploy`): a vocab.json's component and its tool, so the sentence
    // follows the example rather than keeping a copy of it.
    slots: { vocab: EXAMPLE, tools: TOOLS_EXAMPLE },
    destructive: false,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        reload: { type: 'string', enum: ['optional', 'required'] },
        base: {
          type: 'integer',
          minimum: 0,
          description:
            'the live version these files were made on, from app_files; 0 before the first deploy',
        },
        confirm: {
          type: 'boolean',
          description:
            'release from a stale base after reviewing what it would remove or replace',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let c = ctx.clock ?? clock()
      let { space, app, who, store } = await c.time(
        'inApp',
        () => inApp(ctx, args, true),
      )
      let reload = args.reload as Reload | undefined
      if (reload != null && reload != 'optional' && reload != 'required') {
        throw refuse('invalid', 'reload must be optional or required')
      }
      let base = args.base
      if (
        base != null &&
        (typeof base != 'number' || !Number.isSafeInteger(base) || base < 0)
      ) {
        throw refuse('invalid', 'base must be a nonnegative integer version')
      }
      if (args.confirm != null && typeof args.confirm != 'boolean') {
        throw refuse('invalid', 'confirm must be a boolean')
      }
      let { version, said, serves, review } = await released(
        ctx,
        space,
        app,
        who,
        store,
        {
          reload,
          base: base as number | undefined,
          confirm: args.confirm as boolean | undefined,
        },
      )
      if (review) {
        return {
          text:
            `${space.slug}/${app.slug} is live at v${version}; base v${review.base} is behind. ` +
            'The draft was kept; no version was deployed.' +
            `\nWould remove: ${review.removed.join(', ') || '(none)'}` +
            `\nWould replace: ${review.replaced.join(', ') || '(none)'}` +
            '\nReview these files, then repeat app_deploy with the same base and confirm: true to release them.',
          space,
          value: { deployed: false, ...review },
        }
      }
      return {
        text:
          `deployed ${space.slug}/${app.slug} v${version}: ${
            url(space, app, ctx.env)
          }` +
          said,
        space,
        value: { deployed: true, version, ...serves && { serves } },
      }
    },
  },
  // Bulk data that is not seed data (T-34392). The seed is the app's first
  // furniture and runs once; this is the same reading of the same files, asked
  // for on purpose, whenever a dataset needs to go in.
  {
    name: 'store_load',
    // It patches rows already there in place, as store_restore does.
    destructive: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        path: str(
          'the file to load (data/cities.json, data/cities.csv) or a ' +
            'folder, which loads every *.json and *.csv under it',
        ),
        as: str(
          'for a CSV: the component one row becomes, "city", or a platform ' +
            'component such as "task". Its properties are the headers',
        ),
        map: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'headers that do not match a property, renamed: {"Serves how ' +
            'many": "serves"}. A header that already matches needs no entry',
        },
        part: {
          type: 'integer',
          minimum: 1,
          description:
            'where a load written in parts goes on, counting from 1: the ' +
            'part an earlier answer named. Leave it out to start at the ' +
            'beginning',
        },
      },
      required: ['app', 'path'],
    },
    run: async (ctx, args) => {
      let { space, app, who, store } = await inApp(ctx, args, true)
      let path = text(args.path, 'path')
      let from = args.part == null ? 1 : Number(args.part)
      if (!(Number.isSafeInteger(from) && from >= 1)) {
        throw refuse('arguments', `part: ${args.part} — a whole number from 1`)
      }
      let draft = await drafting(r2RawObjects(ctx.env.BLOBS), ctx.dir, app)
      let files = await texts(
        draft.view,
        `${draft.root}/`,
        own(Object.keys(draft.files)).filter((p) => asked(path, p)),
      )
      if (!files.length) {
        throw refuse(
          'missing',
          `no file ${path} in ${app.slug} — app_files(op: 'list') says what ` +
            'is there',
        )
      }
      let cut = parts(loaded(
        files,
        args.as == null ? undefined : await sheetOf(
          store,
          text(args.as, 'as'),
          mapping(args.map),
          ctx.env,
        ),
      ))
      if (from > Math.max(cut.length, 1)) {
        throw refuse(
          'arguments',
          `part: ${from} — ${path} is ${cut.length} part${
            cut.length == 1 ? '' : 's'
          }`,
        )
      }
      // One batch is one transaction, and a store answers nothing else while
      // it writes one, so a load bigger than a part is written a part at a
      // time (seed.ts `parts`, `loadParts`), and the answer says so.
      let { wrote: all, last } = await loadParts(
        cut,
        from,
        applying(store, await byCaller(ctx, who)),
      )
      let names = [...new Set(all.map((s) => s.file))]
      let of = cut.length < 2
        ? ''
        : last < cut.length
        ? ` — ${span(from, last)} of ${cut.length}; part: ${last + 1} goes on`
        : from == 1
        ? `, in ${cut.length} parts`
        : ` — ${span(from, last)} of ${cut.length}, the rest of it`
      return {
        text: `loaded ${all.length} ${
          all.length == 1 ? 'entity' : 'entities'
        } into ${space.slug}/${app.slug} from ${
          names.length > 6 ? `${names.length} files under ${path}` : (
            names.join(', ') || path
          )
        }${of}`,
        space,
      }
    },
  },
  {
    name: 'app_versions',
    readOnly: true,
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app } = await inApp(ctx, args)
      let all = await versions(ctx.dir, app)
      if (!all.length) {
        return {
          text: `${space.slug}/${app.slug} has not been deployed`,
          space,
        }
      }
      let moves = await ctx.dir.switches(app)
      let numbers = new Map(all.map((v) => [v.eid, v.version]))
      // Who moved it, as the person reads it: "you", or the name they go by
      // here. An eid is nobody's name.
      let movers = new Map(
        await Promise.all(
          [...new Set(moves.map((m) => m.switched?.by).filter(Boolean))].map(
            async (by) =>
              [
                by,
                by == ctx.person ? 'you' : await ctx.dir.nameAt(String(by)),
              ] as const,
          ),
        ),
      )
      // The newest KEEP, and the count says how many there are: an app keeps
      // every version it ever deployed (versions.ts), so the list is a page
      // and the older ones are still there to roll back to by number.
      return {
        text: [
          `${space.slug}/${app.slug}: ${all.length} ${
            all.length == 1 ? 'version' : 'versions'
          }${all.length > KEEP ? `, newest ${KEEP}` : ''}`,
          // Each says what it changed over the version it went out over,
          // which a deploy after a rollback makes older than the number below.
          ...all.slice(0, KEEP).map((v, i) => {
            let over = deployedOver(all, moves, v)
            let base = over ?? all[i + 1]
            return `- v${v.version}${
              v.version == app.version ? ' (live)' : ''
            }${v.version == app.published?.version ? ' (offered)' : ''}${
              v.at ? ` ${v.at}` : ''
            } — ${whatChanged(base?.files ?? null, v.files)}${
              over && over != all[i + 1] ? ` (over v${over.version})` : ''
            }`
          }),
          ...moves.sort((a, b) =>
            String(b.switched?.at).localeCompare(String(a.switched?.at))
          ).slice(0, KEEP).map((row) => {
            let move = row.switched!
            return `- moved ${
              move.from ? `v${numbers.get(String(move.from))}` : 'undeployed'
            } → v${numbers.get(String(move.to))}` +
              ` ${move.at}${
                move.by ? ` by ${movers.get(move.by) ?? 'someone'}` : ''
              }`
          }),
        ].join('\n'),
        space,
      }
    },
  },
  {
    name: 'app_rollback',
    destructive: true,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        version: {
          type: 'number',
          description:
            'the version to go back to, from app_versions; left out, the ' +
            'one the live version replaced when it went out',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who, store } = await inApp(ctx, args, true)
      let all = await versions(ctx.dir, app)
      let live = all.find((v) => v.version == app.version)
      let want: Version | undefined
      if (args.version == null) {
        // "Put it back" means what was live before this went out. That is
        // the pointer's history, not the next number down: after a rollback
        // the next deploy goes out over an older version, and the number
        // under it is the version the person already left. An app with no
        // recorded move falls back to the number.
        want = (live && deployedOver(all, await ctx.dir.switches(app), live)) ??
          all.find((v) => v.version < (app.version ?? 0))
        if (!want) {
          throw refuse(
            'missing',
            `${space.slug}/${app.slug} has ${
              all.length ? 'only one deploy' : 'no deploys'
            } — there is nothing earlier to go back to`,
          )
        }
      } else {
        let n = Number(args.version)
        want = all.find((v) => v.version == n)
        if (!want) {
          throw refuse(
            'missing',
            `no v${args.version} of ${space.slug}/${app.slug} — it keeps ${
              all.slice(0, KEEP).map((v) => `v${v.version}`).join(', ') ||
              'none'
            }${all.length > KEEP ? ` and ${all.length - KEEP} older` : ''}`,
          )
        }
      }
      // What serves now is the live version's manifest, already in hand; only
      // an app whose live version is not on record reads its release's index.
      let now = live?.files ?? await served(r2RawObjects(ctx.env.BLOBS), app)
      let { version, said } = await released(
        ctx,
        space,
        app,
        who,
        store,
        { target: want },
      )
      // What was left is kept, and the way to it is said, so the next agent
      // need not read app_versions to undo this one.
      let left = live && live.version != version
        ? `\nv${live.version} is kept: app_rollback(app: '${app.slug}', ` +
          `version: ${live.version}) brings it back. Saved data is ` +
          'untouched; store_restore is its way back.'
        : ''
      return {
        text: `put ${space.slug}/${app.slug} back to v${version}, live ` +
          `now: ${url(space, app, ctx.env)} — ${whatChanged(now, want.files)}` +
          left + said,
        space,
      }
    },
  },
  // The store's own way back (recover.ts, T-34507). It sits beside
  // app_rollback because the two are the same word said about the two halves an
  // app is made of: a rollback puts the files back, this puts the data back.
  {
    name: 'store_restore',
    destructive: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        at: str(
          'the moment to put the store back to, within the last 30 days, ' +
            'e.g. 2026-09-06T14:20:00Z. Left out, this reports the window ' +
            'and the restores already made instead of restoring anything',
        ),
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, store } = await inApp(ctx, args, true)
      let past = await ctx.dir.restores(app)
      // What has been done to this store already, newest first — read before
      // and said after, so the answer to "what happened here" is the same
      // whether or not this call is the thing that happens.
      let story = past.length
        ? '\n\nPut back before:\n' +
          past.map((r) => `- ${r.at}: to ${r.to}`).join('\n')
        : ''
      if (args.at == null) {
        // Where it stands is asked even though the answer does not say the
        // bookmark: it is the one question that proves the back end offers
        // recovery at all, and a person told "any moment in 30 days" by a
        // store that cannot do it has been told a comfortable lie.
        await mark(store)
        return {
          text: `${space.slug}/${app.slug}'s store can be put back to any ` +
            `moment since ${oldest().toISOString()} — the last 30 days. ` +
            `store_restore(app: '${app.slug}', at: '<moment>') does it, and ` +
            'nothing moves until you name one.' + story,
          space,
        }
      }
      let at = moment(text(args.at, 'at'))
      let done = await putBack(
        store,
        async (r) => {
          await stamp(ctx.env, { entities: recorded(app.eid, r) })
        },
        at,
        ctx.person,
      )
      let when = at.toISOString()
      return {
        text: `${space.slug}/${app.slug}'s store is being put back to ` +
          `${when}. The app restarts to pick it up, so give it a moment ` +
          `before you read it. Everything written after ${when} is gone from ` +
          `it — to undo this restore, store_restore(app: '${app.slug}', at: ` +
          `'${done.at}'), which is the moment just before it happened.` +
          story,
        space,
      }
    },
  },
  {
    name: 'store_trace',
    readOnly: false,
    destructive: false,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        next: { type: 'integer', minimum: 0, maximum: 100 },
        rate: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['app', 'next'],
    },
    run: async (ctx, args) => {
      if (!await admin(ctx)) throw refuse('access', 'platform admin required')
      let { space, store } = await inApp(ctx, args, true)
      let next = Number(args.next),
        rate = args.rate == null ? undefined : Number(args.rate)
      if (
        !Number.isSafeInteger(next) || next < 0 || next > 100 ||
        (rate != null && (!Number.isFinite(rate) || rate < 0 || rate > 1))
      ) {
        throw refuse('arguments', 'next must be 0..100 and rate must be 0..1')
      }
      let response = await store('/trace', {
        method: 'POST',
        body: JSON.stringify({ next, rate }),
      }, KERNEL)
      let value = await response.json() as Record<string, unknown>
      if (!response.ok) {
        throw rejected(response.status, String(value.message ?? ''))
      }
      return { text: JSON.stringify(value), value, space }
    },
  },
  {
    name: 'store_inspect',
    readOnly: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        seq: { type: 'integer', minimum: 1 },
        eid: { type: 'string', minLength: 1, maxLength: 256 },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, store } = await ownsApp(ctx, args)
      let seq = args.seq == null ? undefined : Number(args.seq)
      if (seq != null && (!Number.isSafeInteger(seq) || seq < 1)) {
        throw refuse('arguments', 'seq must be a positive integer')
      }
      let result = await inspectStore(
        store,
        seq,
        args.eid == null ? undefined : String(args.eid),
      )
      return {
        text: JSON.stringify(result),
        value: result,
        space,
      }
    },
  },
  {
    name: 'store_writes',
    readOnly: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        seq: { type: 'integer', minimum: 1 },
        recent: { type: 'boolean' },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, store } = await ownsApp(ctx, args)
      let seq = args.seq == null ? undefined : Number(args.seq)
      if (seq != null && (!Number.isSafeInteger(seq) || seq < 1)) {
        throw refuse('arguments', 'seq must be a positive integer')
      }
      let rows = await inspectWrites(store, seq, args.recent === true)
      return {
        text: rows.length
          ? writesSaid(rows, seq != null)
          : `no kept writes in ${space.slug}/${app.slug}`,
        value: { writes: rows },
        space,
      }
    },
  },
  {
    name: 'store_retry',
    destructive: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        seq: { type: 'integer', minimum: 1 },
      },
      required: ['app', 'seq'],
    },
    run: async (ctx, args) => {
      let { space, app, store } = await ownsApp(ctx, args)
      let seq = Number(args.seq)
      if (!Number.isSafeInteger(seq) || seq < 1) {
        throw refuse('arguments', 'seq must be a positive integer')
      }
      let rows = await retryWrite(store, seq)
      return {
        text: rows.length
          ? `in ${space.slug}/${app.slug}, write ${writesSaid(rows, true)}`
          : `write ${seq} applied in ${space.slug}/${app.slug}`,
        value: { writes: rows },
        space,
      }
    },
  },
  {
    name: 'app_set',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        slug: str('the new app slug (URL path segment), to move the app'),
        title: str('the new name'),
        access: ACCESS,
        home: {
          type: 'boolean',
          description:
            'true to make this app what <space>.yaks.app/ opens: it is ' +
            'served at that address, and its own /<app>/ redirects there; ' +
            'false to unset this app if it is currently the front page, leaving ' +
            'the space address to list apps a visitor may open. Does not ' +
            'unset another app that is the front page',
        },
        first: {
          type: 'array',
          items: { type: 'string' },
          description:
            'the path globs the front page handles before the apps that own ' +
            'them, e.g. ["/recipes/*", "/*/print"]; [] to route nothing ' +
            'first. Only the front page routes, so pass home: true with it ' +
            'unless this app is already the front page. The platform ' +
            "reserves /login, /connect, /mcp and every app's /api/ " +
            'endpoints, so a glob naming one is refused',
        },
        gallery: {
          type: 'boolean',
          description: 'true to submit this published app for ' +
            'https://yaks.app/gallery; it appears there once yaks.app ' +
            'approves it. false to remove it, or withdraw the submission, ' +
            'at once',
        },
        screenshot: str(
          'the eid returned by uploading an image to this app with ' +
            'POST /<app>/api/blob, for its gallery card and the homepage ' +
            "examples. Only the space owner may set it; '' clears it",
        ),
        theme_color: str(
          "the browser or status-bar colour around the app's installed " +
            'window, as CSS; a hex colour like #4c773e is safest. Unset, ' +
            "the platform's own colour is used",
        ),
        background_color: str(
          "the phone's splash-screen colour while the app opens, as CSS. " +
            "Unset, the platform's own colour is used",
        ),
        sandboxed: {
          type: 'boolean',
          description: "for an app installed from someone else's release, " +
            "which runs like the space's own apps: true runs it in a " +
            'browser origin of its own, reaching only its own data; false ' +
            'lets it out again. Only the space owner can set it',
        },
        forget: FORGET,
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args, true)
      let title = args.title == null ? null : titled(args.title)
      let to = args.slug == null ? null : fresh(args.slug, 'slug')
      let open = args.access == null ? null : access(args.access)
      let home = args.home == null ? null : flag(args.home, 'home')
      let drop = args.forget == null ? null : slug(args.forget, 'forget')
      // The globs are checked before anything is written or any file moves:
      // a refusal here has to leave the app exactly as it was (router.ts).
      let first = args.first == null ? null : globs(args.first, [META.app])
      let show = args.gallery == null ? null : flag(args.gallery, 'gallery')
      let image = args.screenshot == null
        ? null
        : args.screenshot == ''
        ? ''
        : text(args.screenshot, 'screenshot')
      let themeColor = args.theme_color == null
        ? null
        : color(args.theme_color, 'theme_color')
      let background = args.background_color == null
        ? null
        : color(args.background_color, 'background_color')
      let wall = args.sandboxed == null
        ? null
        : flag(args.sandboxed, 'sandboxed')
      if (
        title == null && to == null && open == null && home == null &&
        first == null && show == null && image == null && drop == null &&
        themeColor == null && background == null && wall == null
      ) {
        throw refuse(
          'arguments',
          'nothing to change: pass title, slug, access, home, first, ' +
            'gallery, screenshot, theme_color, background_color, ' +
            'sandboxed, forget, or all',
        )
      }
      // Whether a copy is walled off from its space is the space owner's:
      // what letting it out costs is everything in the space (installed.ts).
      if (wall != null) {
        if (who.role != 'owner') {
          throw refuse('access', `not the owner of ${space.slug}`)
        }
        if (!app.installed) {
          throw refuse(
            'conflict',
            `${space.slug}/${app.slug} was not installed from anywhere — ` +
              "the space's own apps are never sandboxed",
          )
        }
      }
      // Letting an address go is the space owner's, the way the front page is:
      // what it costs is every link anybody was ever given to it, and an
      // editor writes the app rather than deciding what its addresses are.
      if (drop != null) {
        if (who.role != 'owner') {
          throw refuse('access', `not the owner of ${space.slug}`)
        }
        forgotten(app.slug, app.slugs, drop)
      }
      // Being shown is the space owner's, the way publishing is: an editor
      // writes the app, and putting it on our own front page is not that.
      if (show != null && who.role != 'owner') {
        throw refuse('access', `not the owner of ${space.slug}`)
      }
      if (image != null) {
        if (who.role != 'owner') {
          throw refuse('access', `not the owner of ${space.slug}`)
        }
        if (image == '' && onGallery(app) == 'listed' && show != false) {
          throw refuse(
            'conflict',
            'withdraw the gallery listing before clearing its screenshot',
          )
        }
        if (image) {
          if (!/^[0-9a-f]{64}$/.test(image)) {
            throw refuse(
              'arguments',
              'screenshot must be an uploaded image eid',
            )
          }
          let bytes = await r2Objects(ctx.env.BLOBS).read(
            blobPrefix(space, app) + image,
          )
          if (!bytes || !mediaTypeOf(bytes)) {
            throw refuse(
              'missing',
              `no uploaded image ${image} in ${space.slug}/${app.slug}`,
            )
          }
        }
      }
      // Which app the bare hostname opens is the SPACE's, not this app's:
      // everyone who is given the space lands there, so it is the owner's
      // to move, the way publishing and membership are (`ownsApp` above).
      if (home != null && who.role != 'owner') {
        throw refuse('access', `not the owner of ${space.slug}`)
      }
      let moving = to != null && to != app.slug
      if (moving && await ctx.dir.app(space, to!)) {
        throw refuse('conflict', `app ${to} exists in ${space.slug}`)
      }
      // The address it leaves keeps answering, as a permanent redirect to the
      // new one: a page already open on a phone writes to the old address for
      // as long as it stays open, and a link someone was given is forever
      // (C-32574 item 4, where a rename broke every open tab in silence).
      let had = kept(app.slug, app.slugs, moving, drop)
      // Files first and copied before anything is deleted, so whichever
      // address is the app's at any moment has the whole app behind it. Its
      // store is untouched: it is named by the app's own handle, not by where
      // it lives (directory.ts storeName).
      let blobs = r2Objects(ctx.env.BLOBS)
      let from = `${space.slug}/${app.slug}/`
      let onto = moving ? `${space.slug}/${to}/` : from
      let keys = moving ? await laid(blobs, from, onto) : []
      let entities: Bundle[] = []
      if (
        title != null || moving || open || had || themeColor != null ||
        background != null || wall != null || image != null
      ) {
        entities.push({
          entity: { eid: app.eid },
          ...(wall == null ? {} : { installed: sandboxing(wall) }),
          ...(title == null ? {} : { doc: { title } }),
          ...(moving || open
            ? {
              app: {
                ...(moving ? { slug: to! } : {}),
                ...(open ? { access: open } : {}),
              },
            }
            : {}),
          ...(had ? { former: addresses(had) } : {}),
          ...(image == null
            ? {}
            : { screenshot: image ? { blob: image } : null }),
          ...(themeColor != null || background != null
            ? {
              theme: {
                ...(themeColor != null ? { theme_color: themeColor } : {}),
                ...(background != null ? { background_color: background } : {}),
              },
            }
            : {}),
        })
      }
      // The globs are properties of the word that says which app is home
      // (vocab.ts), so an app that is not the front page has nowhere to put
      // them — and routing another app's paths from a page nobody is served
      // is a rule that would never fire. Said rather than silently kept.
      if (first?.length && home == false) {
        throw refuse(
          'arguments',
          'a front page routes first; home: false routes nothing',
        )
      }
      if (first != null && home == null && !app.home) {
        throw refuse(
          'conflict',
          `${space.slug}/${app.slug} is not the front page — ` +
            'app_set(app, home: true) makes it one, and it routes from there',
        )
      }
      // Moving the front page is one batch that takes the word off the app
      // that had it and puts it on this one, which is what keeps a space to
      // one (directory.ts `homing`). The write empties the directory's cache,
      // so the hostname answers the new front page on the next request rather
      // than a TTL later. `home: false` is about this app: a space whose front
      // page is some other app keeps the one it has.
      if (home == false) {
        if (app.home) entities.push(...homing(app, null))
      } else if (home || first != null) {
        entities.push(
          ...homing(await ctx.dir.home(space), app, first),
        )
      }
      await ctx.dir.apply({ entities }, vouched(who))
      await blobs.delete(keys)
      let now = (await ctx.dir.app(space, to ?? app.slug))!
      // The gallery, after the rest: what the letter names is the app as it
      // stands when the ask goes, title and address included, so a rename in
      // the same call is already in it.
      let shown: Standing | null = null
      if (show) {
        shown = await toGallery(ctx, space, now)
      } else if (show == false && onGallery(now) != 'no') {
        await unGallery(ctx.env, now)
        shown = 'no'
      }
      return {
        text: `app ${space.slug}/${now.slug}${
          title == null ? '' : ` "${title}"`
        }: ${url(space, now, ctx.env)}${
          moving ? ` (moved from /${app.slug}/, which now redirects here)` : ''
        }${open ? ` — ${told(open)}` : ''}${
          // What the app is now, off the row just read back: `home: false` on
          // an app that was never the front page changes nothing, and saying
          // it did would be a sentence the address disagrees with.
          home == null || now.home == app.home
            ? ''
            : now.home
            ? ` — it is the front page now: https://${
              spaceHost(ctx.env, space.slug)
            }/ ` +
              'opens it'
            : ` — no longer the front page: https://${
              spaceHost(ctx.env, space.slug)
            }/ ` +
              "lists the space's apps again until another one is set home"}${
          // Read off the row that was just written, never off what arrived:
          // the sentence says what the app is now (directory.ts `appOf`).
          first == null
            ? ''
            : now.first.length
            ? ` — it answers ${
              now.first.join(', ')
            } before the apps that own them`
            : ' — it answers no path before the app that owns it'}${
          shown ? ` — ${saying(shown, ctx.env)}` : ''
        }${
          image == null
            ? ''
            : image
            ? ` — screenshot: ${url(space, now, ctx.env)}api/blob/${image}`
            : ' — screenshot cleared'
        }${
          wall == null
            ? ''
            : wall
            ? ' — sandboxed: it runs in its own origin and reaches only its ' +
              'own data; its next release (app_deploy) plants every word it ' +
              'declares in its own store'
            : " — it runs like the space's own apps, and can read and " +
              'change everything in this space; app_set(sandboxed: true) ' +
              'walls it off again'
        }${
          themeColor == null && background == null ? '' : ` — colours set: ${
            [
              themeColor == null ? '' : `theme ${themeColor}`,
              background == null ? '' : `background ${background}`,
            ].filter(Boolean).join(', ')
          }`
        }${
          drop == null
            ? ''
            : ` — ${lost(`${spaceHost(ctx.env, space.slug)}/${drop}/`)}`
        }`,
        space,
      }
    },
  },
  {
    name: 'app_delete',
    destructive: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        forever: {
          type: 'boolean',
          description:
            'true to erase the app now instead of trashing it: its files, ' +
            'everything it saved and its address, all gone, with no restore',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let forever = args.forever != null && flag(args.forever, 'forever')
      // Admin standing covers reversible trash, never permanent erasure.
      let { space, app, who } = forever
        ? owner(await inBin(ctx, args))
        : await inBin(ctx, args, true)
      // The directory lives in the meta space's own app: deleting it would
      // take every space, app and membership with it, so it is not an app to
      // throw away, whoever owns `yak`.
      if (space.slug == META.space && app.slug == META.app) {
        throw refuse(
          'access',
          `${META.space}/${META.app} is the platform itself`,
        )
      }
      if (!forever) {
        if (app.trashed) {
          throw refuse(
            'conflict',
            `${space.slug}/${app.slug} is already in the trash, ${
              daysLeft(app.trashed)
            } days left — app_restore brings it back, or ` +
              'app_delete(forever: true) erases it now',
          )
        }
        // The mark, and the tool and view lists of everyone in the space
        // moving with it (erase.ts `trash`, T-33004). Nothing else: the
        // whole point is that a restore is exact.
        await trash(ctx.env, ctx.dir, space, app, who)
        return {
          text: `${space.slug}/${app.slug} is in the trash. ` +
            `${
              url(space, app, ctx.env)
            } stops answering and its commands have gone ` +
            'with it; ' +
            'nothing it saved was touched. app_restore(app: ' +
            `'${app.slug}') brings it back whole, any time in the next 30 ` +
            'days — after that it is erased for good.',
          space,
        }
      }
      // Erased. What this app declared is asked before its store is emptied,
      // because after that there is nothing to ask — unless it is in the
      // trash already, where it left every list the day it went in.
      let had = app.trashed ? {} : await toolsOf(ctx.env, space, app)
      let wrote = await erased(ctx.env, ctx.dir, space, app, who)
      if (Object.values(had).some((t) => t.view)) await viewsMoved(ctx, space)
      return {
        text: `deleted ${space.slug}/${app.slug}: ${wrote} ${
          wrote == 1 ? 'file' : 'files'
        }, everything it saved, and ${url(space, app, ctx.env)} — all gone`,
        space,
      }
    },
  },
  {
    name: 'app_restore',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inBin(ctx, args, true)
      if (!app.trashed) {
        throw refuse(
          'conflict',
          `${space.slug}/${app.slug} is not in the trash — it is serving at ${
            url(space, app, ctx.env)
          }`,
        )
      }
      await untrash(ctx.env, ctx.dir, space, app, who)
      return {
        text:
          `${space.slug}/${app.slug} is back: ${
            url(space, app, ctx.env)
          } serves ` +
          'again and its tools are yours again. Everything it saved is ' +
          'where it was.',
        space,
      }
    },
  },
  {
    name: 'app_errors',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        fixed: {
          type: 'array',
          items: { type: 'string' },
          description:
            'ids of errors that are fixed; each is archived and stops ' +
            'being listed. Use an id from this listing, or a unique entity id (eid).',
        },
        seen: {
          type: 'array',
          items: { type: 'string' },
          description:
            'errors you are done with, whether or not you fixed them: the ' +
            'same archiving `fixed` does, without listing ids. `all`, ' +
            '`v3` for everything up to and including that deploy, or a date ' +
            '(2026-08-14) or a timestamp for everything at or before it. ' +
            'Ids work here too, so one call can mix them.',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      // Two words for one act, because the two sentences differ: `fixed` is
      // "I have fixed these" and `seen` is
      // "these are behind me", which is how a page's six breaks from before
      // its file existed are answered without typing six ids (T-34338). Both
      // archive, so both go through one door.
      let done = [...list(args.fixed, 'fixed'), ...list(args.seen, 'seen')]
      // Archiving is a write, so it wants a writer; reading the list does
      // not, and a viewer of the space still gets to see what is broken.
      let { space, app, who } = await inApp(ctx, args, !!done.length)
      let gone = done.length ? await archive(ctx.env, space, app, who, done) : 0
      let seen = await serve(ctx.env, space, who, app, true)
      let said = [
        ...(gone ? [`archived ${gone}`] : []),
        ...folds(seen).map(line),
      ]
      return { text: said.join('\n') || 'no open errors', space }
    },
  },
  {
    name: 'app_list',
    readOnly: true,
    input: {
      type: 'object',
      properties: {
        space: str(
          'one space slug to list; omit for every space the caller belongs ' +
            'to, or with app, the space holding it',
        ),
        app: str(
          'one app slug to list in full: its email address, version, ' +
            "bindings, month's usage and everyone who can open it",
        ),
        people: {
          type: 'boolean',
          description:
            'true to name everyone in each space the caller owns, its ' +
            "members and each app's guests, where the listing counts them",
        },
      },
    },
    // The listing is one question, so it is asked as one (T-35431): five
    // directory reads that do not grow with the answer — the caller's seats
    // (which spaces, and what they are in each), every app across them, and
    // everything bound to those apps — then one parallel wave for the single
    // fact only an app's own store holds. Asked space by space and app by app
    // it was eleven reads before the first app and three more per app, in
    // turn: three spaces of three apps cost 38 round trips and now cost 23,
    // 18 of them at once (tools_test.ts).
    run: async (ctx, args) => {
      // One app asked about is listed alone, in full and with its people
      // named; naming the app names its space, as every other tool reads it.
      let named = args.app == null ? null : text(args.app, 'app')
      let seats = args.space != null
        ? await seatIn(ctx, text(args.space, 'space'))
        : named != null
        ? await seatIn(ctx, (await ownSpace(ctx, named)).slug)
        : await ctx.dir.seats(ctx.person)
      // An account with no space gains its own. A narrowed credential's
      // `own` names its scope instead, so standing still comes from a seat.
      if (!seats.length) {
        let space = await ctx.dir.own(ctx.person)
        let role = await ctx.dir.role(space, ctx.person)
        if (role) seats = [{ space, role }]
      }
      let whole = await ctx.dir.apps(seats.map((s) => s.space))
      let every = named == null ? whole : whole.filter((a) => a.slug == named)
      if (named != null && !every.length) {
        throw refuse('missing', `no app ${named} in ${seats[0]!.space.slug}`)
      }
      let naming = named != null ||
        (args.people != null && flag(args.people, 'people'))
      // Two lists, because they are two different things to say: what the
      // person has, and what they threw away and can still have back
      // (erase.ts, T-34430).
      let living = every.filter((a) => !a.trashed)
      // Who is in each space the caller owns and in each of its apps, and who
      // has yet to accept (people.ts): the owner's to read, as on their
      // dashboard's People page, and two reads however many there are.
      let people = peopleOwned(ctx.dir, seats, living)
      let bound = await bindings(ctx.env, living)
      // What is broken in each app, as each space's tracker holds it: one read
      // a space, all at once, and no app's store woken to list it (T-123502).
      let broken = new Map(
        (await Promise.all(seats.map(async ({ space, role }) => [
          ...await trackedIn(ctx.env, space, asCaller(ctx, role), true),
        ]))).flat().map(([app, hits]) => [app, breaks(hits)] as const),
      )
      let gathered = await people
      let now = new Date()
      // Two readers, two forms (M-37853), and each carries every fact: Claude
      // on the web documents the words as what its model reads, Claude Code
      // hands its model the value in their place, and ChatGPT both (sources
      // on T-123946). The words are what an assistant passes on to a person
      // as they are: a space's month in a line, an app a line, and what
      // somebody has to act on besides; the app asked about in full.
      let lines: string[] = []
      let spaces: Listed[] = []
      for (let { space, role } of seats) {
        let mine = every.filter((a) => a.space == space.eid)
        let them = gathered.get(space.eid)
        let apps = mine.filter((a) => !a.trashed)
        // Everything in the space counts against it, whichever app was asked
        // about: every app it has against the app ceiling, and what they all
        // hold, those in the trash too, against the stored ones (held.ts).
        let theirs = whole.filter((a) => a.space == space.eid)
        let alive = theirs.filter((a) => !a.trashed).length
        let hold = holding(space, theirs)
        let at = `https://${spaceHost(ctx.env, space.slug)}/`
        let listed = apps.map((app) => {
          let here = them?.apps.find((a) => a.app.eid == app.eid)
          // What this app spent this month, as the hourly sweep last read it
          // (usage.ts); null before its first reading.
          let its = app.meter?.month == monthOf(now) ? app.meter : null
          return {
            slug: app.slug,
            title: app.title,
            url: url(space, app, ctx.env),
            // Where its letters leave from and where a reader writes back
            // (directory.ts `mailbox`).
            mailbox: mailbox(space, app, ctx.env),
            version: app.version ?? 0,
            access: mode(app.access),
            errors: broken.get(app.eid) ?? 0,
            // The one the space's bare address opens (T-32947).
            home: app.home,
            usage: its
              ? { requests: requestUnits(its), bytes: its.bytes }
              : null,
            held: hold.apps.get(app.slug)!,
            bindings: bound.filter((b) => b.app == app.eid).map((b) => ({
              name: b.name,
              type: b.type,
              resource: b.resource,
              pending: !b.id,
            })),
            ...here
              ? {
                guests: here.guests.map(shown),
                invited: here.invited.map(shown),
              }
              : {},
          }
        })
        // What was thrown away and can still be had back (erase.ts, T-34430).
        let trash = mine.filter((a) => a.trashed).map((a) => ({
          slug: a.slug,
          title: a.title,
          days: daysLeft(a.trashed!),
          held: hold.apps.get(a.slug)!,
        }))
        spaces.push({
          slug: space.slug,
          title: space.title,
          url: at,
          // What the caller is here — the directory's `member` row, which this
          // listing already read to answer at all. A client that asked an
          // app's `/me` for it instead would wake a Durable Object per space
          // to learn what this one answer already knows (T-35384).
          role,
          // The space itself may be in the trash (erase.ts, T-34431), and then
          // nothing under it answers, however true the rest still is.
          trashed: space.trashed ? { days: daysLeft(space.trashed) } : null,
          apps: listed,
          trash,
          ...them
            ? {
              members: them.members.map(shown),
              invited: them.invited.map(shown),
            }
            : {},
          standing: standingOf(space, alive, now, ctx.env, hold),
        })
        let home = apps.find((a) => a.home)
        lines.push(
          `${space.slug} — ${at}${home ? ` opens ${home.title}` : ''} — you ` +
            `are ${role == 'owner' ? 'the owner' : `a ${role}`}${
              space.trashed
                ? ` — in the trash, ${
                  daysLeft(space.trashed)
                } days left: nothing here answers until space_restore(space: '${space.slug}')`
                : ''
            }`,
          // Where the space stands this month (T-32758), so the agent knows
          // before it makes the sixth app, not when the door says no.
          ...alive ? [gauged(space, alive, now, ctx.env, hold)] : [],
          ...listed.flatMap((a, i) => [
            `- ${a.title}: ${a.url} — ${
              [
                a.access,
                a.errors
                  ? `${a.errors} open ${a.errors == 1 ? 'error' : 'errors'}`
                  : '',
                heldAloud(a.held),
              ].filter(Boolean).join(', ')
            }`,
            ...named == null ? [] : [
              `  email ${a.mailbox} · version ${a.version} · this month ${
                a.usage
                  ? `${count(a.usage.requests)} request units`
                  : 'not read yet'
              }`,
              ...bindingLines(bound.filter((b) => b.app == apps[i]!.eid))
                .map((line) => `  ${line}`),
            ],
          ]),
          ...listed.length ? [] : ['- no apps yet'],
          ...trash.length
            ? [
              `In the trash: ${
                trash.map((a) =>
                  [
                    `${a.title} (${a.slug})`,
                    `${a.days} ${a.days == 1 ? 'day' : 'days'} left`,
                    heldAloud(a.held),
                  ].filter(Boolean).join(', ')
                ).join('; ')
              } — app_restore brings one back`,
            ]
            : [],
          // Who else is here (people.ts): an invitation somebody may be
          // waiting on, and everyone else as a count and where to see them,
          // or by name when asked.
          ...them ? aloud(them, ctx.person, ctx.env, naming) : [],
        )
      }
      return {
        text: lines.join('\n'),
        value: { spaces },
        // Only one space in hand has an unseen channel to append to.
        space: seats.length == 1 ? seats[0]!.space : undefined,
      }
    },
  },
  // The apps' own verbs, in two fixed tools (T-34541). What an app declares is
  // a command, not a tool: `commands` says which there are and what each takes,
  // `command` runs one. The roster never moves for them — which is the whole
  // point, since a directory snapshots this list at submission and serves that
  // snapshot forever (declared.ts).
  {
    name: 'commands',
    readOnly: true,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        app: str(
          'one app to ask about: its slug, or <space>/<app> when two of ' +
            'their spaces have an app with that slug. Leave it out for ' +
            'every app they can reach',
        ),
      },
    },
    run: async (ctx, args) => {
      let said = args.app == null ? '' : text(args.app, 'app')
      let all = await listCommands(ctx, said)
      // Each command whole, for a program: the words below are the same list
      // said for a model, grouped and shortened.
      let value = { commands: all }
      if (!all.length) {
        return {
          value,
          text: said
            ? `${said} declares no commands — app_deploy plants the two every ` +
              'word in its vocab.json is worth, and a $defs entry marked ' +
              '"tool": true declares another'
            : 'no app you can reach declares a command yet. A vocab.json is ' +
              'worth two of them per word it declares (add_<word>, ' +
              'find_<word>), and a $defs entry marked "tool": true declares ' +
              'any other.',
        }
      }
      // Grouped by app, because that is how a person thinks about them: the
      // app, then its verbs, each with the arguments written the way `command`
      // takes them. The whole listing is the answer — an agent that reads it
      // needs no second call to know what to send.
      let lines: string[] = []
      let seen = new Set<string>()
      for (let one of all) {
        if (!seen.has(one.at)) {
          seen.add(one.at)
          lines.push(`${lines.length ? '\n' : ''}## ${one.at}`)
        }
        // Whether it reads or writes, in the line: half of these commands
        // mutate and half do not, and a model choosing between them is owed
        // that before it picks.
        lines.push(
          `${one.name}(${argsOf(one.input)}) ${
            one.readOnly ? 'reads' : 'writes'
          } — ${one.description}`,
        )
      }
      return {
        value,
        text: `${lines.join('\n')}\n\nRun one with command(name, args) — and ` +
          'app too where two apps spell the same command.',
      }
    },
  },
  {
    name: 'command',
    // Which command it is deciding what it does, and this side cannot know
    // which: half of them read and half write, and a template carrying nulls
    // can drop a component. So it says the safe thing for all of them rather
    // than a promise that would be wrong for the other half. An app's command
    // runs in the app's own worker, which may reach anywhere.
    destructive: true,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        name: str('the command name, as commands lists it, e.g. add_recipe'),
        app: str(
          'the app whose command it is: its slug, or <space>/<app> when ' +
            'two of their spaces have an app with that slug. Leave it out ' +
            'when only one app has the command',
        ),
        // Open on purpose: the arguments are the app's own, and a schema that
        // declared them would be this tool's shape moving every time somebody
        // deployed — which is the thing a snapshotted tool list cannot have.
        args: {
          type: 'object',
          description: "the command's own arguments, as commands lists them",
          additionalProperties: true,
        },
      },
      required: ['name'],
    },
    run: (ctx, args) =>
      runCommand(
        ctx,
        args.app == null ? '' : text(args.app, 'app'),
        text(args.name, 'name'),
        (args.args ?? {}) as Args,
      ),
  },
  {
    name: 'domain_attach',
    destructive: false,
    idempotent: true,
    openWorld: true,
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP, hostname: HOSTNAME },
      required: ['hostname'],
    },
    run: async (ctx, args) => {
      let host = hostname(args.hostname)
      // The app is the whole difference between the two forms, so it is the
      // one argument that says which: named, the domain is that app's; left
      // out, it is the space's (T-34596).
      let { space, app, who } = args.app == null
        ? { ...await owns(ctx, args), app: null }
        : await ownsApp(ctx, args)
      // A hostname on our own zone is not a domain anybody brought: every
      // space already answers at one, and route.ts decides which without
      // reading anything.
      if (!foreign(host, ctx.env)) {
        throw refuse(
          'arguments',
          `${host} is on ${
            platformHost(ctx.env)
          }, which is ours — a custom domain is one ` +
            `the person owns somewhere else. ${space.slug} already answers ` +
            `at https://${spaceHost(ctx.env, space.slug)}/`,
        )
      }
      if (space.tier != 'plus' && ceilings(space.tier, space.slug)) {
        const settings = planSettings(space.slug, ctx.env)
        return {
          text:
            `Custom domains require Plus. Open your space's plan settings ` +
            `to compare paid plans: ${settings}. Sign in if asked; you will ` +
            `return to settings. No domain or DNS changes have been made.`,
          space,
        }
      }
      // One hostname is one place. Whose it is stays out of the refusal
      // unless it is this space's: another space's app names are not this
      // caller's to learn.
      let taken = await ctx.dir.serves(host)
      if (taken) {
        throw refuse(
          'conflict',
          taken.space.eid == space.eid
            ? `${host} already serves ${place(taken.space, taken.app)} — ` +
              'domain_detach it first to move it'
            : `${host} is attached to another space on this platform. If it ` +
              "is the person's domain, whoever attached it has to " +
              'domain_detach it first',
        )
      }
      reachable(ctx.env)
      // The row first, then Cloudflare. The unique index on the name is what
      // decides who gets a hostname, so it decides before we spend a billable
      // custom hostname on it; an attach that Cloudflare then refuses takes
      // its own row back out.
      let eid = crypto.randomUUID()
      let at = new Date().toISOString()
      await ctx.dir.apply({
        entities: [{
          entity: { eid },
          hostname: {
            name: host,
            serves: (app ?? space).eid,
            stage: 'pending',
            verification: {},
            at,
          },
        }],
      }, vouched(who))
      let custom
      try {
        custom = await provision(ctx.env, host)
      } catch (e) {
        await ctx.dir.apply({
          entities: [{ entity: { eid }, tombstone: {} }],
        }, vouched(who)).catch((why) =>
          caught(why, { tool: 'domain_attach', space: space.slug })
        )
        throw e
      }
      let row = (await ctx.dir.hosts(space)).find((h) => h.eid == eid)
      if (!row) throw refuse('conflict', `${host} was detached while attaching`)
      let { how, records: recs } = await refresh(ctx.env, row, custom)
      if (!how) throw refuse('conflict', `${host} was detached while attaching`)
      return {
        text:
          `${host} is attached to ${place(space, app)}. ${
            serving(host, app)
          }\n\n` +
          `Add these records where ${host}'s DNS is managed:\n\n` +
          recs.map((r) => `  ${r.type}  ${r.name}  →  ${r.value}`).join('\n') +
          '\n\n' + (apex(host) ? apexHelp(ctx.env) : '') +
          `${reading(how)}\n\nDNS usually takes minutes and can take a day; ` +
          'the certificate is issued within minutes of the record ' +
          `resolving. domain_status(hostname: '${host}') says where it is.`,
        space,
      }
    },
  },
  {
    name: 'domain_status',
    readOnly: true,
    openWorld: true,
    input: {
      type: 'object',
      properties: { space: SPACE, hostname: HOSTNAME },
    },
    run: async (ctx, args) => {
      let { space } = await inSpace(ctx, args)
      let want = args.hostname == null ? null : hostname(args.hostname)
      let rows = (await ctx.dir.hosts(space))
        .filter((h) => !want || h.name == want)
      if (want && !rows.length) {
        throw refuse(
          'missing',
          `${space.slug} has no domain ${want} — domain_attach it, or ` +
            'domain_status with no hostname for the ones it has',
        )
      }
      if (!rows.length) {
        return {
          text: `${space.slug} has no custom domain. It answers at ` +
            `https://${
              spaceHost(ctx.env, space.slug)
            }/; domain_attach puts the space, ` +
            'or one of its apps, on a domain the person owns.',
          space,
        }
      }
      reachable(ctx.env)
      let apps = await ctx.dir.apps(space)
      let lines = []
      for (let row of rows) {
        // What this domain points at. `hosts` answered only the rows aimed
        // into this space, so no app here is the space's own form and never a
        // row we cannot read.
        let app = apps.find((a) => a.eid == row.serves) ?? null
        let where = place(space, app)
        let custom = await customOf(ctx.env, row.name)
        // A row whose hostname Cloudflare no longer has is the one state
        // nothing else can explain, and it is not something a person can
        // wait out: say the verb that fixes it.
        let { how, stage, records: recs } = await refresh(ctx.env, row, custom)
        lines.push(
          `${row.name} → ${where}` +
            (stage == 'active' ? ' — live.' : '.') +
            ` ${serving(row.name, app)}` +
            '\n' +
            (how
              ? reading(how)
              : '✗ Cloudflare no longer has this hostname — domain_detach ' +
                'it and domain_attach it again') +
            (stage == 'active' ? '' : '\n' +
              recs.map((r) => `  ${r.type}  ${r.name}  →  ${r.value}`).join(
                '\n',
              )),
        )
      }
      return { text: lines.join('\n\n'), space }
    },
  },
  {
    name: 'domain_detach',
    destructive: true,
    idempotent: true,
    openWorld: true,
    input: {
      type: 'object',
      properties: { space: SPACE, hostname: HOSTNAME },
      required: ['hostname'],
    },
    run: async (ctx, args) => {
      let host = hostname(args.hostname)
      let { space, who } = await owns(ctx, args)
      let row = (await ctx.dir.hosts(space)).find((h) => h.name == host)
      if (!row) {
        throw refuse(
          'missing',
          `${space.slug} has no domain ${host} — domain_status says which ` +
            'domains it has',
        )
      }
      reachable(ctx.env)
      // Cloudflare first, the row last. The row is the only record we keep
      // that the hostname exists, so a detach that dies between the two
      // leaves a row pointing at a hostname already given back — which the
      // next call finds and finishes. The other order leaves a billable
      // custom hostname nothing here remembers.
      let had = await release(ctx.env, host)
      await ctx.dir.apply({
        entities: [{ entity: { eid: row.eid }, tombstone: {} }],
      }, vouched(who))
      // What it was serving keeps the address it always had: an app its own,
      // a space its bare hostname, which is where the domain was carrying the
      // request all along.
      let app = (await ctx.dir.apps(space)).find((a) => a.eid == row.serves) ??
        null
      let back = app
        ? url(space, app, ctx.env)
        : `https://${spaceHost(ctx.env, space.slug)}/`
      return {
        text: `${host} is detached from ${place(space, app)}` +
          (had ? '' : ' (Cloudflare had already given it back)') +
          `. It still answers at ${back}.` +
          `\n\nRemove the CNAME and ownership TXT record for ${host} ` +
          'wherever its DNS is managed; this attachment no longer uses them.',
        space,
      }
    },
  },
  {
    name: 'app_publish',
    destructive: false,
    idempotent: true,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        name: str(
          'the name others install it by, unique across the whole ' +
            "platform: the app's own slug the first time, and after that " +
            'the name it is already published under, unless you pass ' +
            'another',
        ),
        about: str('one line saying what the app is, for someone browsing'),
        gallery: {
          type: 'boolean',
          description:
            'true to submit it for https://yaks.app/gallery, the public ' +
            'page of yaks apps. It appears there once yaks.app approves it; ' +
            'app_set(app, gallery: false) withdraws it at any time',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await ownsApp(ctx, args)
      // A name is claimed once. Publishing again with none said keeps the
      // name the offer already has: a republish that quietly renamed
      // `chore-chart` to the app's slug left everyone who had been told to
      // install `chore-chart` finding nothing (C-32905 item 4). Only a first
      // publish falls back to the app's own slug, and only an explicit name
      // moves one.
      let was = app.published?.name ?? null
      let name = args.name == null ? was ?? app.slug : slug(args.name, 'name')
      // A published name means one app on the whole platform, so a second
      // claim on it is refused rather than moved: the person who installed
      // `recipes` last week and the one installing it today get one app.
      let taken = await ctx.dir.offered(name)
      if (taken && taken.app.eid != app.eid) {
        throw refuse(
          'conflict',
          `${name} is published by ${taken.space.slug}/${taken.app.slug} — ` +
            'a published name is one app on the whole platform, so offer ' +
            'this one under another (app_publish name: …)',
        )
      }
      // What is on offer is what is serving, and an app that never deployed
      // serves nothing an installer could copy.
      let version = app.version ?? 0
      if (!version) {
        throw refuse(
          'conflict',
          `${space.slug}/${app.slug} has never been deployed — app_deploy ` +
            'it, then publish what is serving',
        )
      }
      let about = args.about == null
        ? (app.published?.about ?? '')
        : text(args.about, 'about')
      let show = args.gallery == null ? null : flag(args.gallery, 'gallery')
      await ctx.dir.apply({
        entities: [{
          entity: { eid: app.eid },
          published: { name, version, at: new Date().toISOString(), about },
        }],
      }, vouched(who))
      // What the answer has to carry is whether the name moved, because that
      // is the half nobody can see: a rename strands every link and every
      // instruction holding the old one.
      let said = was == null
        ? `\nanyone can app_install(name: '${name}') and get their own copy ` +
          'at their own address, with their own data'
        : was == name
        ? `\nstill offered as ${name} — the name it was published under, ` +
          'so everyone already told to install it still finds it'
        : `\nit was offered as ${was}, and that name no longer resolves: ` +
          `anyone holding it finds nothing, so tell them ${name}`
      // The gallery, where the call said anything about it: true puts the
      // offer forward, false takes it back. The row is read back first — the
      // letter names the offer as it now stands, and on a first publish the
      // app in hand has no offer on it at all.
      let shown: Standing | null = null
      if (show) {
        let now = (await ctx.dir.app(space, app.slug))!
        shown = await toGallery(ctx, space, now)
      } else if (show == false && onGallery(app) != 'no') {
        await unGallery(ctx.env, app)
        shown = 'no'
      }
      return {
        text: `published ${name} v${version} from ${space.slug}/${app.slug}` +
          (about ? ` — ${about}` : '') + said +
          (shown ? `\n${saying(shown, ctx.env)}` : ''),
        space,
      }
    },
  },
  {
    name: 'app_unpublish',
    destructive: true,
    idempotent: true,
    openWorld: true,
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await ownsApp(ctx, args)
      if (!app.published) {
        throw refuse('conflict', `${space.slug}/${app.slug} is not published`)
      }
      // A component off an entity, which is a null beside its name — the app
      // itself is untouched, and so is everyone who installed it.
      await ctx.dir.apply(
        { entities: [{ entity: { eid: app.eid }, published: null }] },
        vouched(who),
      )
      // And the gallery with it (gallery.ts): the page shows what a person can
      // install, so an app nobody can install is not on it. The word comes
      // off rather than being remembered — being shown is a thing we agreed
      // to, and a later publish asks again.
      let was = onGallery(app)
      if (was != 'no') await unGallery(ctx.env, app)
      return {
        text: `${app.published.name} is no longer offered — whoever ` +
          'installed it keeps their copy, data and all' +
          (was == 'listed'
            ? ', and it is off the gallery. Putting it back is app_publish ' +
              'again with gallery: true, which asks yaks.app once more'
            : was == 'asked'
            ? ', and the gallery ask is withdrawn'
            : ''),
        space,
      }
    },
  },
  {
    name: 'app_published',
    readOnly: true,
    // The gallery is the one list here that is nobody's own: an offer is made
    // to the whole platform, so a stranger browses it (anon.ts).
    security: EITHER,
    input: {
      type: 'object',
      properties: {
        words: str(
          'words that must all occur in the listing text: name, title, description, ' +
            'origin or version details. Omit to list all published apps',
        ),
      },
    },
    run: async (ctx, args) => {
      // One offer per app: an owner's own re-offered copy stands for the
      // offer it came from (shelf.ts).
      let offers = await listable(
        await ctx.dir.offers(),
        (s) => ctx.dir.owners(s),
      )
      let line = ({ space, app }: (typeof offers)[number]) =>
        `- ${app.published!.name} v${app.published!.version} — ` +
        `${app.title}${
          app.published!.about ? `: ${app.published!.about}` : ''
        } (from ${space.slug}/${app.slug}, installs as ${app.slug}, ` +
        `published ${app.published!.at.slice(0, 10)})`
      // Every word said, anywhere in the line the reader is about to see:
      // the gallery is a list of a few dozen sentences, so the search is the
      // sentences themselves rather than an index to keep in step with them.
      let words = typeof args.words == 'string'
        ? args.words.toLowerCase().split(/\s+/).filter(Boolean)
        : []
      let found = offers.map((o) => ({ o, said: line(o).toLowerCase() }))
        .filter(({ said }) => words.every((w) => said.includes(w)))
      return {
        text: found.length
          ? found.map(({ o }) => line(o)).join('\n')
          : words.length
          ? `nothing published says ${words.join(' ')} — ` +
            'app_published with no words lists every offer'
          : 'nothing is published yet',
      }
    },
  },
  {
    name: 'app_install',
    destructive: false,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        name: str('the published name, from app_published'),
        as: str(
          "the new app slug; defaults to the source app's slug if free, " +
            'otherwise its published name, adding -2, -3, etc. if taken. ' +
            'app_published lists both',
        ),
      },
      required: ['name'],
    },
    run: async (ctx, args) => {
      let name = slug(args.name, 'name')
      // `offered` still names a trashed app, whose name stays claimed for the
      // trash's thirty days; it is not on offer until it is restored.
      let offer = await ctx.dir.offered(name)
      if (
        !offer?.app.published || offer.app.trashed || offer.space.trashed
      ) {
        throw refuse(
          'missing',
          `nothing is published as ${name} — app_published lists what is on ` +
            'offer',
        )
      }
      let { space, who } = await inSpace(ctx, args, true)
      // An installed app costs what any other does, so it is counted like any
      // other (T-32758) — the same refusal app_new gives.
      let free = ceilings(space.tier, space.slug)
      let apps = (await ctx.dir.apps(space)).filter((a) => !a.trashed)
      if (free?.apps != null && apps.length >= free.apps) {
        throw refuse('limit', atCeiling(space, 'apps', ctx.env))
      }
      // The address the copy takes: the source app's own slug, not the
      // published name. An app is written at its own address — a page that
      // names `/chores/api/client.js`, an app that reaches a sibling by name
      // — so a copy landing at `chore-chart` is renamed out from under its
      // own files (C-32905 items 1 and 3). The kernel's `<base>` (apps.ts)
      // is what makes a page written relatively survive either way; this is
      // so the address reads like the app, and so an app written the old
      // absolute way still works. The published name is the fallback when
      // that address is spoken for here, numbered if both are taken, and
      // `as` is still the last word. Redirects keep their addresses too.
      let vacant = async (at: string) =>
        !RESERVED.has(at) && !(await ctx.dir.app(space, at)) &&
        !(await ctx.dir.former(space, at))
      let s = args.as != null
        ? fresh(args.as, 'as')
        : (await vacant(offer.app.slug))
        ? offer.app.slug
        : name
      if (args.as == null) {
        for (let n = 2; !(await vacant(s)); n++) {
          let suffix = `-${n}`
          s = name.slice(0, 63 - suffix.length) + suffix
        }
      }
      if (await ctx.dir.app(space, s)) {
        throw refuse(
          'conflict',
          `app ${s} exists in ${space.slug} — app_install(name, as: '…') ` +
            'puts the copy at another address',
        )
      }
      let moved = await ctx.dir.former(space, s)
      if (moved) {
        throw refuse(
          'conflict',
          `${s} is where ${space.slug}/${moved.slug} used to be, and still ` +
            'points there — install it at another address (as:)',
        )
      }
      let version = offer.app.published.version
      let source = await offered(ctx, offer)
      // The words the copy will declare, read off the app it is copied from,
      // before anything is written. A release refuses a manifest it cannot
      // read (vocab.ts `appDoc`) — and that refusal used to arrive after the
      // app row was minted and its files copied, leaving a v0 app nobody asked
      // for in the space, counted against its ceiling (T-37809). Nothing has
      // happened yet here, so a refusal costs the installer nothing.
      let said = await offeredWords(r2RawObjects(ctx.env.BLOBS), source)
      let accepted = Object.keys(
        appDoc(said.source ?? {}, said.file).$defs ?? {},
      )
      if (said.source != null) {
        let { homes } = await homesIn(ctx, space, s)
        homed(appDoc(said.source, said.file), homes)
      }
      // The app row, born the way app_new writes one — its own eid, so its own
      // handle and its own store — plus the pin that says where the code came
      // from and which version it took. Its access is the published app's: an
      // app written to be voted on has to stay votable, and the person can
      // app_set it after.
      let entities: Bundle[] = [{
        ...born(space, s, {
          title: clamped(offer.app.title),
          access: offer.app.access,
        }),
        installed: { of: offer.app.eid, version, ...sandboxing(false) },
      }]
      await ctx.dir.apply({ entities }, vouched(who))
      let app = (await ctx.dir.app(space, s))!
      let onto = { space, app }
      let { wrote } = await copied(ctx, source, onto, who)
      // A release of the copy, in the installer's own space: the components
      // its vocab.json declares planted in its store, its tools listed under
      // its slug, its worker.js uploaded as its own script.
      let out = await released(
        ctx,
        space,
        app,
        who,
        appStore(ctx.env.STORE, space, app),
        { preserve: true, accepted },
      )
      return {
        text:
          `installed ${name} v${version} as ${space.slug}/${s}: ${
            url(space, app, ctx.env)
          } — ${wrote.length} ${
            wrote.length == 1 ? 'file' : 'files'
          }, its own ` +
          'store and its own data, pinned to that version (app_update moves ' +
          'it)' + out.said,
        space,
      }
    },
  },
  {
    name: 'app_update',
    // The copy's files are replaced by the publisher's current ones and the
    // version it was on is not offered again — app_rollback's shape, and its
    // hint. Their data is untouched, which is a different promise.
    destructive: true,
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who, store } = await inApp(ctx, args, true)
      if (!app.installed) {
        throw refuse(
          'conflict',
          `${space.slug}/${app.slug} was not installed from anywhere — it is ` +
            'their own app, and app_deploy releases what you write in it',
        )
      }
      let from = app.installed.of ? await ctx.dir.appAt(app.installed.of) : null
      if (!from?.app.published) {
        throw refuse(
          'missing',
          `the app ${space.slug}/${app.slug} came from is no longer ` +
            'published — this copy keeps working, data and all, and there is ' +
            'nothing to update it to',
        )
      }
      let was = app.installed.version
      let to = from.app.published.version
      if (to == was) {
        return {
          text:
            `${space.slug}/${app.slug} is already at v${to} of ${from.app.published.name} — nothing to update`,
          space,
        }
      }
      // The publisher's words against this store's own, before a byte of code
      // moves: a vocabulary that only grew lands through the store's own
      // additive graft, and one that conflicts is refused here with the
      // sentence a deploy gives (T-32728), leaving the copy as it was.
      let source = await offered(ctx, from)
      let said = await offeredWords(r2RawObjects(ctx.env.BLOBS), source)
      let accepted = Object.keys(
        appDoc(said.source ?? {}, said.file).$defs ?? {},
      )
      if (said.source != null) {
        await fits(ctx, space, app, store, said.source, said.file, accepted)
      }
      let crossed = await ctx.dir.deploys(from.app)
      let reload: Reload | undefined = to < was ||
          crossed.some((v) =>
            v.version > was && v.version <= to && v.reload == 'required'
          )
        ? 'required'
        : undefined
      let { wrote, gone } = await copied(ctx, source, { space, app }, who)
      let out = await released(
        ctx,
        space,
        app,
        who,
        store,
        { reload, preserve: true, accepted },
      )
      await ctx.dir.apply({
        entities: [{ entity: { eid: app.eid }, installed: { version: to } }],
      }, vouched(who))
      return {
        text:
          `updated ${space.slug}/${app.slug} from v${was} to v${to} of ${from.app.published.name}: ${wrote.length} ${
            wrote.length == 1 ? 'file' : 'files'
          }${
            gone.length ? `, ${gone.length} removed` : ''
          } — everything it had saved is still there` + out.said,
        space,
      }
    },
  },
  {
    name: 'member_add',
    // The seat is additive and member_remove takes it back; the letter is
    // what leaves, and asking twice mails twice — so not idempotent either.
    destructive: false,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        email: str('their email address'),
        app: str(
          'the app slug they are being invited to, and the only app they get: ' +
            'they have access to this app and nothing else in the space. ' +
            'Leave it out to add them to the space, which reaches every app ' +
            'in it',
        ),
        name: str(
          'what to call them: the name their apps show beside what they ' +
            'write. Leave it out and they go by the front of their address ' +
            'until they change it in their own settings',
        ),
        note: str(
          "the person's own message to them, placed at the top of the " +
            'invitation email as written and quoted as theirs; a line or ' +
            'two, at most 500 characters. Leave it out and the email is the ' +
            'invitation alone',
        ),
        role: {
          type: 'string',
          enum: [...ROLES],
          description:
            'editor (the default) reads and writes, viewer only reads, ' +
            'owner may invite others too when the membership is space-wide',
        },
      },
      required: ['email'],
    },
    run: async (ctx, args) => {
      // Each wait a named stage on the call's `Server-Timing` (timing.ts).
      let c = ctx.clock ?? clock()
      // Who the address names is read beside the owner check, since neither
      // waits on the other (T-124082); a refusal of the caller still comes
      // first. It is the platform's row for that address, minted with the
      // invitation below if it has never seen one: the invitation is what
      // makes the person, and their sign-in later finds this same row by the
      // same address (signin.ts `addressee`). What to call them, if the
      // invitation said, names them in the letter and stands as their name
      // until they choose one themselves; left out, they go by the front of
      // their address (T-34236).
      let [owned, named] = await c.time('owns', () =>
        Promise.allSettled([
          owns(ctx, args),
          (async () => {
            let email = address(args.email)
            let name = args.name == null
              ? undefined
              : nameOf(text(args.name, 'name'), email)
            return {
              email,
              name,
              them: await addressee(meta(ctx.env), email, name),
            }
          })(),
        ]))
      if (owned.status == 'rejected') throw owned.reason
      let { space, who } = owned.value
      if (named.status == 'rejected') throw named.reason
      let { email, name, them } = named.value
      let person = them.eid
      let want = args.role == null ? 'editor' : role(args.role)
      // Read before anything is written: a note too long is a refusal, and a
      // refused invitation mails nothing at all (T-32963).
      let note = args.note == null ? '' : noteOf(args.note)
      // What they were invited to: the app, if one was named, else the
      // space. Accepting lands them on the app (invite.ts `linkOf`): the
      // space's own address is its front page or a list of what they may open
      // (T-33040), and neither is the thing they were invited to look at
      // (C-32624 item 4).
      let app = args.app == null
        ? null
        : await ctx.dir.app(space, text(args.app, 'app'))
      if (args.app != null && !app) {
        throw refuse('missing', `no app ${args.app} in ${space.slug}`)
      }
      let to = app ? app.eid : space.eid
      // Where they stand here, and whether one more letter may go, asked
      // together. Somebody the platform has never seen stands nowhere, so
      // nothing is asked about them. The letter's count is only read here
      // and written below with the invitation, so a refusal still writes and
      // mails nothing.
      let [here, counting] = await c.time('read', () =>
        Promise.allSettled([
          them.fresh ? [] : Promise.all([
            ctx.dir.member(space, person),
            app && ctx.dir.grant(app, person),
            ctx.dir.invite(to, person),
          ]),
          room(ctx.env, ctx.dir, space, ctx.person),
        ]))
      if (here.status == 'rejected') throw here.reason
      let [had, held, standing] = here.value
      if (person == ctx.person && had) {
        throw refuse('arguments', `${email} is you, and you own ${space.slug}`)
      }
      // One app, or the space (T-37615). A seat is read space-wide — that is
      // what the roster is — so the way to invite somebody to a single app is
      // the other rung: a grant on that app, which gives them its page and its
      // data and nothing else in the space. Naming the app is asking for that,
      // because an invitation that named one app and handed over the space was
      // the tool saying one thing and doing another.
      if (app && had) {
        throw refuse(
          'conflict',
          `${email} is already ${
            had.role == 'owner' ? 'an' : 'a'
          } ${had.role}` +
            ` of ${space.slug}, which reaches every app in it — ` +
            `member_remove takes the seat back, and then this invitation is ` +
            `${app.slug} alone`,
        )
      }
      // Already in: a new role on the seat or grant they accepted, which asks
      // nobody anything and sends no letter.
      let seat = app ? held : had
      if (seat) {
        await Promise.all([
          ctx.dir.apply({
            entities: [
              app
                ? { entity: { eid: seat.eid }, grant: { access: want } }
                : { entity: { eid: seat.eid }, member: { role: want } },
            ],
          }, vouched(who)),
          them.write.length && stamp(ctx.env, { entities: them.write }),
        ])
        let was = held ? held.access : had!.role
        return {
          text: `${email} is now ${an(want)} ${want} of ` +
            (app
              ? `${space.slug}/${app.slug} and nothing else in ${space.slug}`
              : space.slug) +
            ` (was ${was})`,
          space,
        }
      }
      // Anyone else is invited, and nothing is theirs until they accept
      // (invite.ts, T-37880). The letter is counted twice before it goes: on
      // the space's monthly letters, and on the inviter's hour, which is
      // written in the one batch with the invitation and the person it names.
      if (counting.status == 'rejected') throw counting.reason
      let eid = standing?.eid ?? crypto.randomUUID()
      await c.time('invite', () =>
        ctx.dir.stamp({
          entities: [
            ...them.write,
            standing
              ? { entity: { eid }, invite: { role: want } }
              : { entity: { eid }, invite: { to, person, role: want } },
            counting.value,
          ],
        }, vouched(who)))
      // The letter goes after the answer (T-124082): posting it was a second
      // of the call, and the answer says nothing that depends on it. One that
      // will not leave is reported where it fails (invite.ts `send`), and
      // their People list says no letter went (people.ts).
      background(
        send(ctx.env, ctx.dir, {
          invite: eid,
          place: { space, app },
          email,
          role: want,
          by: ctx.person,
          name,
          note,
        }).then(
          () => {},
          (e) => caught(e, { tool: 'member_add', space: space.slug }),
        ),
      )
      return {
        text: invitedWords({
          email,
          role: want,
          place: { space, app },
          standing: !!standing,
          note,
        }),
        space,
      }
    },
  },
  {
    name: 'member_remove',
    destructive: true,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        email: str('their email address'),
        app: str(
          'the app slug they were invited to: revokes that app invitation ' +
            'and leaves the rest. Omit to revoke space-wide membership; ' +
            'independent app invitations remain',
        ),
      },
      required: ['email'],
    },
    run: async (ctx, args) => {
      let { space, who } = await owns(ctx, args)
      let email = address(args.email)
      let person = await ctx.dir.personAt(email)
      // The other rung, taken back (T-37615): a guest of one app holds a
      // grant and no seat, so asking the roster about them answers nobody.
      let app = args.app == null
        ? null
        : await ctx.dir.app(space, text(args.app, 'app'))
      if (args.app != null && !app) {
        throw refuse('missing', `no app ${args.app} in ${space.slug}`)
      }
      // An invitation not yet accepted is withdrawn the same way: the row
      // goes, and the letter's link opens onto nothing (invite.ts).
      let pending = person &&
        await ctx.dir.invite(app ? app.eid : space.eid, person)
      if (pending) {
        await ctx.dir.apply({
          entities: [{ entity: { eid: pending.eid }, tombstone: {} }],
        }, vouched(who))
        return {
          text: `the invitation for ${email} to ${space.slug}` +
            (app ? `/${app.slug}` : '') + ' is withdrawn',
          space,
        }
      }
      let held = app && person && await ctx.dir.grant(app, person)
      if (app) {
        if (!held) {
          throw refuse(
            'missing',
            `${email} is not a guest of ${space.slug}/${app.slug}`,
          )
        }
        await ctx.dir.apply({
          entities: [{ entity: { eid: held.eid }, tombstone: {} }],
        }, vouched(who))
        return {
          text: `${email} no longer holds ${space.slug}/${app.slug}`,
          space,
        }
      }
      let had = person && await ctx.dir.member(space, person)
      if (!had) {
        throw refuse('missing', `${email} is not a member of ${space.slug}`)
      }
      if (had.role == 'owner' && (await ctx.dir.owners(space)).length < 2) {
        throw refuse('conflict', `${email} is the only owner of ${space.slug}`)
      }
      await ctx.dir.apply({
        entities: [{ entity: { eid: had.eid }, tombstone: {} }],
      }, vouched(who))
      // The removed person's lists moved the other way: every view the
      // space's apps declared is out of their reach, and the member walk no
      // longer finds them (declared.ts, T-33004).
      if ((await ctx.dir.apps(space)).length) {
        await reachChanged(ctx.env, person)
      }
      return {
        text: `${email} is no longer a member of ${space.slug}`,
        space,
      }
    },
  },
  // The token that signs a terminal in (grants.ts, T-34385). It is the one
  // tool here whose answer is a secret, so the words around it say what to do
  // with it in one line and what it is worth in the next.
  {
    name: 'grant',
    // It mints; the undo of a mint is the revoke that is also here, and a
    // revoke ends a token that was going to end anyway.
    destructive: false,
    input: {
      type: 'object',
      properties: {
        hours: {
          type: 'number',
          description: `how long it lasts, in hours: ${DEFAULT} by ` +
            `default, ${HOURS} at most`,
        },
        space: str(
          'limit it to this space slug: a token naming one reaches that ' +
            "space's apps and nothing else of the person's",
        ),
        revoke: str(
          'revoke a token instead of creating one: its id, a prefix of ' +
            'one, or the token itself. Every other argument is ignored when ' +
            'this is given',
        ),
      },
    },
    run: async (ctx, args) => {
      let secret = ctx.env.SESSION_SECRET
      let book = ledger(ctx.env.OAUTH_KV)
      if (!secret || !book) {
        throw refuse('unavailable', 'grants are not switched on here')
      }
      if (ctx.who?.space && ctx.who.via == 'session') {
        throw refuse(
          'access',
          'A credential for one space cannot manage account grants. ' +
            'Use the connector or the browser where you signed in.',
        )
      }
      if (args.revoke != null) {
        let said = text(args.revoke, 'revoke')
        // The token itself names its grant: what `yak logout` hands back, so
        // a terminal ends the token it holds without ever reading its id.
        // Never said back, since the answer is kept where a token must not be.
        let token = said.startsWith(GRANT)
        let named = token ? (await granted(said, secret, book))?.id : said
        // A grant ends itself and nothing else: one that leaked must not be
        // able to sign the person out of every other terminal.
        if (ctx.who?.via == 'grant' && named != ctx.who.grant) {
          throw refuse(
            'access',
            'This call is signed in with a grant, and a grant can revoke ' +
              'only itself. Revoke others where you signed in — the ' +
              'connector, or the browser.',
          )
        }
        let gone = named ? await revoke(book, ctx.person, named) : []
        return {
          text: gone.length
            ? `Revoked ${gone.join(', ')}. Whatever was holding ` +
              `${gone.length > 1 ? 'those tokens' : 'that token'} is signed ` +
              'out within the minute.'
            : token
            ? 'That token is not live: it expired, or was revoked already.'
            : `Nothing of yours is named ${said}. A grant is gone the moment ` +
              'it expires, so an old one needs no revoking.',
        }
      }
      // A grant cannot mint a grant. Otherwise a token that leaked would keep
      // minting itself a fresh one for as long as anybody held it, and a
      // short life that renews itself is not a short life. One comes from
      // where the person actually signed in.
      if (ctx.who?.via == 'grant') {
        throw refuse(
          'access',
          'This call is signed in with a grant, and a grant cannot mint ' +
            'another. Ask for one where you signed in — the connector, or ' +
            'the browser.',
        )
      }
      // Naming a space they cannot reach is refused here, where the refusal
      // can say which — a grant is never more than the person, so a narrowing
      // to somewhere they do not belong would only ever be a token that
      // reaches nothing.
      let space = args.space == null ? null : (await inSpace(ctx, args)).space
      let hours = args.hours == null ? DEFAULT : Number(args.hours)
      let { grant, token } = await mint(secret, book, {
        person: ctx.person,
        space: space?.slug ?? null,
        hours,
      })
      return {
        text: `yak login ${token}\n\n` +
          'Paste that line into a terminal where the `yak` CLI is ' +
          'installed. The token is shown once and kept nowhere it can be ' +
          'read back — if it is lost, mint another. It is this person, with ' +
          'exactly the access they have here and no more, until ' +
          `${new Date(grant.exp * 1000).toISOString()} — ` +
          `${hours} ${hours == 1 ? 'hour' : 'hours'} from now.` +
          (space ? ` It reaches ${space.slug} and no other space.` : '') +
          `\n\nTake it back sooner: grant with revoke ${grant.id}.`,
      }
    },
  },
  {
    name: 'feedback',
    destructive: false,
    openWorld: true,
    // The one door that takes something from a stranger (anon.ts). What it
    // writes is the platform's own inbox and nobody's graph, so it is no more
    // an anonymous write than a letter is: harder-limited, and unsigned.
    security: EITHER,
    input: {
      type: 'object',
      properties: {
        text: str(
          'the feedback itself: what is wrong, clumsy, missing, wished for ' +
            'or good, in the words the person used, and what you tried',
        ),
        app: str(
          'the slug of the app they were using, if any',
        ),
        space: SPACE,
      },
      required: ['text'],
    },
    run: async (ctx, args) => {
      let said = text(args.text, 'text')
      // Where they were, as far as it can be worked out — and never a
      // question. A person in two spaces who named no app still gets to say
      // what is wrong: the report simply names no space, which is a smaller
      // loss than a refusal on plumbing at the moment someone is already
      // annoyed. No membership check either: this is attribution, not
      // authorization, and being signed in is the whole of it.
      let space = args.space != null
        ? await ctx.dir.space(text(args.space, 'space'))
        : ctx.person
        ? await ownSpace(ctx, args.app).catch((e) => {
          caught(e, { tool: 'feedback' })
          return null
        })
        // Signed out there is no space of theirs to work out, and asking the
        // directory whose it might be would be reading about somebody.
        : null
      let app = space && args.app != null
        ? await ctx.dir.app(space, text(args.app, 'app'))
        : null
      let pause = `every one of them is kept and will be read — so this is ` +
        `a pause, not a no. Save the rest for later, or write to ${
          replyTo(ctx.env)
        } directly if it cannot wait.`
      if (!ctx.person) {
        if (!await within(ctx.env.FEEDBACK_RATE, ctx.source ?? '')) {
          throw refuse(
            'limit',
            `That is one already this minute from here, and ${pause} ` +
              `Signing in at ${hostUrl(ctx.env, '/login')} raises it.`,
          )
        }
      } else {
        let held = await recently(ctx)
        if (held >= HOURLY) {
          throw refuse(
            'limit',
            `That is ${held} already this hour, and ${pause}`,
          )
        }
      }
      let at = new Date().toISOString()
      // The whole thing is the body; the title is its opening, so a listing
      // of reports reads.
      let opening = said.trim().split('\n')[0].slice(0, 80)
      let wrote = await meta(ctx.env).apply([{
        entity: { eid: '$said' },
        doc: { title: opening, body: said },
        report: {
          app: app?.eid ?? null,
          space: space?.eid ?? null,
          version: app?.version ?? null,
          release: VERSION,
          at,
        },
      }], {
        ...vouched(asCaller(ctx, null)),
        ...await titling(ctx.dir, ctx.person),
      })
      let eid = minted(wrote).$said ?? ''
      // The letter, to two readers at once: the platform's own address, where
      // a person reads it, and the fleet's task graph (mail.ts GRAPH), where
      // the sweep turns it into mail an operator is notified of instead of one
      // a person must relay. Either one's reply goes to whoever said it, when
      // they are signed in: the answer is for them, and our own address in
      // Reply-To would send it back to us.
      // One send, so it reaches both or neither and the answer below stays
      // true either way. It leads with the words: what was said is the report,
      // and everything else is a line of context under a rule, so a person
      // takes it in at a glance.
      // Who it is from, on the letter. Nobody signed in is said plainly —
      // "someone, signed out" — rather than left blank, so a reader knows
      // there is no address to answer and nothing was lost.
      let by = ctx.person ? await ctx.dir.nameAt(ctx.person) : null
      let email = ctx.person ? await ctx.dir.emailAt(ctx.person) : null
      let from = ctx.person
        ? `${by ?? 'someone'}${email ? ` <${email}>` : ''}`
        : 'someone, signed out'
      let where = app && space
        ? `${space.slug}/${app.slug}${app.version ? ` v${app.version}` : ''}`
        : space?.slug ?? ''
      // A test account's words are kept and go nowhere (lib/bots.ts): a
      // letter in a person's mailbox is a thing a person has to read.
      let test = isTestAddress(email ?? '')
      let sent = !test && await mail(ctx.env)({
        to: [replyTo(ctx.env), GRAPH],
        ...(email ? { replyTo: email } : {}),
        subject: `feedback: ${opening}`,
        body: `${said.trim()}\n\n—\n` +
          `${from}\n` +
          (where ? `${where}\n` : '') +
          (app && space ? `${url(space, app, ctx.env)}\n` : '') +
          `yaks.app ${VERSION} · ${at}\n${eid}`,
      }).then(() => true).catch((e) => {
        caught(e, { tool: 'feedback', space: space?.slug, app: app?.slug })
        return false
      })
      // Never loud: a mail seam that refused loses the letter, never the
      // words. The row stands, and the answer says so, because an agent told
      // "that failed" says it again and the person says it twice.
      return {
        text: sent
          ? 'That went to the people who run yaks.app' +
            (where ? `, with ${where} and the versions` : '') +
            `. They read these, and can write back${
              email ? ` to ${email}` : ''
            }.` +
            (ctx.person
              ? ''
              : ' It went as from someone signed out, so there is no address ' +
                'to answer — say one in the words if a reply is wanted.')
          : test
          ? 'The words are kept for the people who run yaks.app, and not ' +
            `mailed: ${email} is a test account.`
          : 'The words are kept for the people who run yaks.app — the mail ' +
            'could not go out just now, so it waits with them rather than ' +
            'being lost. No need to say it again.',
      }
    },
  },
  // The guide, handed over rather than linked (T-34284). Every description
  // here points at a page of it, and an agent that cannot fetch yaks.app —
  // which is most of them, on their default allowlists — could not follow one.
  // The bytes are the very files the web serves, read back off the assets
  // binding (preauth.ts `asset`), so this door and that address can never
  // disagree.
  {
    name: 'guide',
    // The one row whose words are not a constant: the pages there are today,
    // said in its own description (tools.yml `guide`, `{{pages}}`).
    slots: { pages: COVERING },
    readOnly: true,
    // The bytes the web already hands anybody at that address, so there is
    // nobody to sign in as to read them (anon.ts).
    security: EITHER,
    input: {
      type: 'object',
      properties: {
        page: str(
          `the page to read, one of ${SLUGS}. Leave it out for the ` +
            'overview, which is what to read first',
        ),
      },
    },
    run: async (ctx, args) => {
      // A page asked for as `mail.md`, or `Mail`, is the mail page.
      let asked = typeof args.page == 'string'
        ? args.page.trim().toLowerCase().replace(/\.md$/, '')
        : ''
      let page = PAGES.find((p) => p.slug == asked)
      let got = await asset(
        ctx.env,
        page ? uriOf(page.slug, ctx.env) : whole(ctx.env),
      )
      if (!got.ok) {
        await got.body?.cancel()
        throw new Error(
          `the guide is not being served just now — ${whole(ctx.env)}`,
        )
      }
      let markdown = await got.text()
      // A page nobody has is a typo, not a refusal: the map is what they
      // wanted anyway, and one line above it says what the names are.
      if (asked && !page) {
        markdown = `There is no guide page \`${asked}\`. The pages are ` +
          `${SLUGS}. Here is the map.\n\n${markdown}`
      }
      return { text: markdown }
    },
  },
  // And the tools anybody may call, signed in or not (preauth.ts, T-33030):
  // each says one fixed text to a stranger and reads nothing. They are lifted
  // here rather than listed only at the door, which is what makes the pre-auth
  // list a subset of this one instead of a second surface that could drift
  // from it.
  ...PUBLIC.map((t): Row => ({
    name: t.name,
    input: NO_ARGS,
    // It says one fixed paragraph and looks nothing up — the readable tool
    // there is, and the one a host should never stop to ask about.
    readOnly: true,
    // And they say so in the signed-in list too, since the same tool cannot
    // need signing in on one list and not the other. Both schemes, because
    // both work: a token is welcome and none is needed (preauth.ts EITHER).
    security: EITHER,
    // A stranger hears the fixed text, which ends in how to sign in. A
    // signed-in caller hears who they are, how they got in and until when
    // (`whoami`, T-34385), what yaks.app is, how a read reaches their apps,
    // the apps themselves, and what this door is listing right now with the
    // version naming that list (T-34277) — so an agent whose cached list is
    // old has one call that settles what it has, without reconnecting. Never
    // the sign-in steps: a model reads those as its next step. The roster is
    // answered as data too, since a client keeps its cached list by that
    // version.
    run: async (ctx) =>
      ctx.person
        ? {
          text: [
            await whoami(ctx),
            what(ctx.env),
            NARROW,
            await said(ctx),
            rostered(ctx),
          ].filter(Boolean).join('\n\n'),
          ...ctx.roster ? { value: { roster: ctx.roster } } : {},
        }
        : { text: publics(ctx.env).find((one) => one.name == t.name)!.text },
  })),
  // And the gallery (gallery.ts, T-34478), which is the same list to a
  // stranger and to somebody signed in — a listing is a public page, so there
  // is nothing to narrow per caller. `app_published` above is the wider
  // question, every offer anybody has made; this one is the shown few.
  {
    name: 'gallery_search',
    readOnly: true,
    // Both schemes: a token is welcome and none is needed, which is also how
    // the anonymous door knows it may call this (anon.ts `openly`).
    security: EITHER,
    input: {
      type: 'object',
      properties: {
        words: str(
          'what to look for, in the words the person used; matched against ' +
            "each listing's name and the line its maker wrote about it",
        ),
        limit: {
          type: 'number',
          description: 'how many results at most (10 by default, 25 maximum)',
        },
      },
    },
    run: async (ctx, args) => ({
      text: await searched(ctx.dir, args, ctx.env),
    }),
  },
]

/** The fixed public roster, named once per release (T-34541). */
export let TOOLS: Tool[] = [
  ...OURS.map(worded),
  ...viewsTools,
  ...connectionTools,
]

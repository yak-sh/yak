// The connector's PLATFORM tools (D-32318 §Code, build, deploy): the least
// that makes an app. The generic graph tier is no longer here — @yaks/mcp
// brings graph_apply, graph_query, graph_show, graph_schema and search over
// the caller's reach as one graph (agent.ts, T-33812), and a second copy of
// them scoped to a (space, app) would be a dimmer one. What is here is the
// sugar: space_new, app_new,
// app_files, app_deploy, app_versions and app_rollback — the deploys an app
// keeps and the word that puts one back (versions.ts, T-32886) — app_set,
// app_delete, app_errors, app_list, the three
// that give an app's own worker a key it alone can read — app_secret_set,
// app_secret_list, app_secret_remove, whose values never enter this graph
// (T-32779) — the three that make an app a plugin: app_publish offers it to
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
import type { Security } from '@yaks/mcp'
import type { Blobs } from '../../src/blobs.ts'
import { r2Blobs } from '../../src/blobs_r2.ts'
import { parseTools, TOOLS_EXAMPLE, viewsOf } from '../../src/store/tools.ts'
import {
  borrowed,
  EXAMPLE,
  grow,
  homed,
  type Homes,
  livesIn,
  parseVocab,
  type Vocab,
} from '../../src/store/vocab.ts'
import type { EntityLiteral } from '../../src/mutation.ts'
import { appAccess } from '../../src/types.ts'
import { VERSION } from '../../src/version.ts'
import { appDoc, coreDocs, shortOf, TEACH } from './vocab.ts'
import { withKinds } from './kinds.ts'
import type { VocabDoc } from '@yaks/vocab'
import type { Cols, Sheet } from './csv.ts'
import { mimeOf, purged } from './files.ts'
import {
  type Access,
  type App,
  appStore,
  bornAt,
  type Directory,
  homing,
  mailbox,
  META,
  type Role,
  type Space,
  stamp,
  storeName,
  url,
} from './directory.ts'
import { moved, reachChanged, toolsOf } from './declared.ts'
// A whole store put back to a moment (T-34507) — the data half of what
// app_rollback does for an app's files.
import { mark, moment, oldest, putBack, recorded } from './recover.ts'
// Only the ceiling, and only ever called: tools.ts and standing.ts are a
// cycle through declared.ts, so nothing from there may be read while this
// module's own body runs.
import { tooLong } from './standing.ts'
import { meta, minted } from './meta.ts'
import { memories, remember } from './memory.ts'
import {
  daysLeft,
  doomed,
  door,
  erased,
  keeping,
  letter,
  naming,
  refused,
  ticket,
  trash,
  untrash,
  untrashSpace,
} from './erase.ts'
import {
  carried,
  drop,
  dropSecret,
  NEEDS_TOKEN,
  SECRET_NAME,
  secrets,
  setSecret,
  upload,
  WORKER,
} from './dispatch.ts'
import {
  apex,
  customOf,
  HOST,
  provision,
  reachable,
  reading,
  records,
  release,
  stageOf,
  steps,
} from './domains.ts'
import type { Env } from './env.ts'
// The gallery is its own part (gallery.ts): the two stamps, the letter that
// carries the decision, and the listing every door here reads.
import {
  ask as askGallery,
  door as galleryDoor,
  drop as unGallery,
  letter as galleryLetter,
  saying,
  searched,
  type Standing,
  standing as onGallery,
  ticket as ticketFor,
} from './gallery.ts'
import type { Caller } from './identity.ts'
import { DEFAULT, HOURS, ledger, mint, revoke } from './grants.ts'
import { GRAPH, mail, REPLY_TO } from './mail.ts'
import { PAGES, uriOf, WHOLE } from './guide.ts'
import { asset, EITHER, NO_ARGS, PUBLIC } from './preauth.ts'
import {
  type Box,
  boxOf,
  BUDGET,
  CAP,
  CWD,
  paid,
  type Spend,
  spending,
  TIMEOUT,
} from './sandbox.ts'
import { foreign, SIGN_IN, SLUG } from './route.ts'
import { globs } from './router.ts'
import type { Reach } from './reach.ts'
import { titling, vouched, type Who } from './session.ts'
import { mode, reads, writes } from '@yaks/member'
import { canon, nameOf, personOf } from './signin.ts'
import { type Door, storeOf } from './door.ts'
import {
  type Applying,
  asked,
  load,
  loaded,
  seedy,
  sow,
  type Sown,
  type Text,
} from './seed.ts'
import {
  archive,
  cards,
  healed,
  line,
  openIn,
  rewrote,
  serve,
} from './unseen.ts'
import {
  atCeiling,
  builds,
  ceilings,
  countedSandbox,
  letters,
  monthOf,
  size,
  spent,
  standing,
} from './meter.ts'
import {
  held,
  history,
  manifest,
  own,
  pinned,
  record,
  replaced,
  restore,
  restored,
  sha256,
  snapshot,
  type Version,
  versions,
  whatChanged,
  when,
} from './versions.ts'
// The one ceiling on bytes going into an app's store, wherever they arrive
// from: an upload, a drop, or `app_files` fetch.
import { MAX } from './apps.ts'
import { NOT_ON, statsOf } from './views.ts'

export type Ctx = {
  env: Env
  dir: Directory
  person: string
  // How this caller got in, when a door knows (mcp.ts sets it from
  // identity.ts `asking`): the session, a connector's token, or a CLI grant,
  // with what that credential says about itself. `about` reads it to answer
  // who is asking and until when, and `grant` reads it to refuse minting a
  // grant from a grant. Absent where nobody asked — the builder's own loop
  // runs these tools for a person it already knows (builder.ts).
  who?: Caller
  // The tool list this door is serving and the version naming it (mcp.ts,
  // T-34277). Set after the tools are assembled, since it is made OF them, so
  // only a tool RUNNING sees it — which `about` is.
  roster?: { version: string; names: string[] }
  // What the apps in reach say about themselves (standing.ts), assembled once
  // per request by the door that also puts it in `initialize.instructions`
  // (mcp.ts). `about` says it again, because a client that cached the
  // instructions at connect has no other way to read them fresh.
  standing?: string
  // The container time this BUILD has spent (sandbox.ts `Spend`), where a
  // build is what is running: builder.ts mints one per loop and pays for it
  // at the end. A connector call arrives without one and gets a fresh one, so
  // a single tool call is its own budget — which is as much as one call could
  // spend anyway, since a command is capped at sandbox.ts `TIMEOUT`.
  spend?: Spend
}
type Args = Record<string, unknown>
// What a tool answers: the text, the space it worked in (so the door can
// append what is unseen there), and, for a tool with a view, the same answer
// as data — the host hands it to the iframe as the result's
// structuredContent (mcp.ts, MCP Apps spec §Notifications).
export type Out = { text: string; space?: Space; data?: unknown }

type Shape = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export type Tool = {
  name: string
  // A short human title — a noun phrase, not a sentence. Both connector
  // directories require one on every tool, and a person picking through a
  // permission prompt reads it instead of the snake_case name.
  title: string
  description: string
  // The `ui://` resource that draws this tool's answer, if it has one.
  view?: string
  // What this one DOES, as the four MCP hints (@yaks/graph `Tool`, emitted by
  // @yaks/mcp `annotated`). A host reads them to decide what it may call
  // without asking, so they say what the tool does and not what would be
  // convenient: readOnly for a pure look-up, destructive for what deletes or
  // cannot be undone, idempotent for a setter that converges, openWorld for
  // anything reaching past yaks.app. A write that says nothing is taken to be
  // destructive, so silence can only ever tighten a prompt.
  readOnly?: boolean
  destructive?: boolean
  idempotent?: boolean
  openWorld?: boolean
  // What its `data` is shaped like, when it answers a value beside its words.
  // JSON Schema, like `input` — agent.ts turns both into the Zod the MCP SDK
  // wants, so nothing here depends on a validation library.
  output?: Shape
  // Who may call it (MCP Apps §Tools, `_meta.ui.visibility`): the model
  // always; add 'app' for a tool a view's own button calls back through the
  // host, which the host refuses for any tool that does not say so.
  visibility?: ('model' | 'app')[]
  // What it declares about signing in (`_meta.securitySchemes`), where that is
  // not what the door declares for everything it lists: a tool anybody may
  // call says `noauth` (preauth.ts NOAUTH, mcp.ts SIGNIN).
  security?: Security[]
  input: Shape
  run: (ctx: Ctx, args: Args) => Promise<Out>
}

// The tool list, said out loud: the version that names it and every tool in
// it. It is what `about` adds for a signed-in caller — the answer to "is my
// list still the list", which a client cannot ask any other way.
let rostered = (ctx: Ctx) =>
  ctx.roster
    ? `\n\nThe tools here right now, roster ${ctx.roster.version}:\n` +
      `${ctx.roster.names.join(', ')}\n\nIf a reply ever says the tool list ` +
      'changed, that is this version moving: reconnect, or call about again ' +
      'to see what is here.'
    : ''

// The apps in reach, as `initialize` already told this client (standing.ts):
// what each holds, and the standing instructions beside it. Said again here
// because a client caches the instructions at connect and a person's apps move
// under it — an app made this morning is one the agent would otherwise not
// know to put this afternoon's recipe in.
let said = (ctx: Ctx) => ctx.standing ? `\n\n${ctx.standing}` : ''

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
  let name = await ctx.dir.nameAt(ctx.person)
  let email = await ctx.dir.emailAt(ctx.person)
  return `\n\nYou are signed in as ${name ?? ctx.person}` +
    `${email ? ` <${email}>` : ''}, ${HOW[who.via]}` +
    `${who.grant ? ` ${who.grant}` : ''}` +
    `${
      who.space ? `, which reaches the space ${who.space} and no other` : ''
    }` +
    `${who.until ? `, until ${new Date(who.until * 1000).toISOString()}` : ''}.`
}

let str = (description: string) => ({ type: 'string', description })

let SPACE = str(
  "the space slug — <space>.yaks.app. Leave it out: the person's own space " +
    'is used, and where you name an app, the space is whichever of theirs ' +
    'holds it. Name one only when a refusal asks you to',
)
let APP = str('the app slug within the space')

let HOSTNAME = str(
  'the domain, whole and as it will be typed into a browser — ' +
    'herbusiness.com, or www.herbusiness.com. No scheme and no path',
)

// What to say when the hostname is a domain's apex, where DNS forbids a
// CNAME. This is the step a non-technical person gives up at, so the answer
// they need is in the answer they already have, not a page away.
let APEX =
  'This is the apex — the bare domain, with nothing in front of it — and ' +
  'DNS does not allow a CNAME there. Three ways through, best first: move ' +
  "the domain's DNS to Cloudflare (free, and its CNAME flattening makes the " +
  "apex work), or use the registrar's own ALIAS/ANAME record type with the " +
  'same value (Porkbun has one; GoDaddy, Namecheap, Squarespace and Hover ' +
  'do not), or attach www.<domain> instead and redirect the apex to it. ' +
  'Call guide with page domains, which walks through each ' +
  '(https://yaks.app/guide/domains.md).\n\n'

// What an app lets someone who is not a member do with its data (T-32504).
// The person's agent picks it from their ask, which is why the words are the
// ask and not the mechanism.
let ACCESS = {
  type: 'string',
  enum: [...appAccess],
  description:
    "who may read and write the app's data: public (the default) — anyone " +
    'with the link reads it, the person and whoever they invite write it; ' +
    'open — anyone with the link writes too, which is what a vote page, a ' +
    'shared list or a signup sheet needs; private — nobody but the person ' +
    'and whoever they invite, either way',
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
 * What an `app_files` call is asking for, when it did not say. BYTES say what
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

let text = (v: unknown, what: string) => {
  if (typeof v != 'string' || !v) throw new Error(`${what} is required`)
  return v
}

// A list argument, forgiving of a model that sends one id bare: a string
// and a list of one mean the same thing, and refusing the string would only
// teach the agent to guess again.
let list = (v: unknown, what: string) =>
  v == null ? [] : (Array.isArray(v) ? v : [v]).map((one) => text(one, what))

// A file's BYTES, from either spelling of them (T-34263): `content` is the
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
    throw new Error(`${at}base64: not base64`)
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
    throw new Error('files: a list of {path, content}')
  }
  return v.map((one, i) => {
    if (!one || typeof one != 'object') {
      throw new Error(`files[${i}]: {path, content}`)
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
  if (!(appAccess as readonly string[]).includes(s)) {
    throw new Error(`access: one of ${appAccess.join(', ')}`)
  }
  return s as Access
}

// A yes or a no. Models send a JSON boolean where the schema says one and
// the word where they are typing prose, so both are read rather than
// teaching an agent to guess again (`list` above takes the same line).
let flag = (v: unknown, what: string) => {
  if (typeof v == 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  throw new Error(`${what}: true or false`)
}

let role = (v: unknown): Role => {
  let s = text(v, 'role')
  if (!(ROLES as string[]).includes(s)) {
    throw new Error(`role: one of ${ROLES.join(', ')}`)
  }
  return s as Role
}

// An address, in the one spelling the platform stores (signin.ts canon), so
// an invite and the sign-in that answers it are the same person.
let address = (v: unknown) => {
  let at = canon(text(v, 'email'))
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(at)) {
    throw new Error('email: an address like name@example.com')
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
    throw new Error(
      'hostname: a domain like herbusiness.com or www.herbusiness.com',
    )
  }
  return s
}

let slug = (v: unknown, what: string) => {
  let s = text(v, what)
  if (!SLUG.test(s)) throw new Error(`${what}: not a slug (a-z, 0-9, -)`)
  return s
}

// A secret's name is a binding, which the app's own code spells as
// `env.NAME` — so it must be a JavaScript name (dispatch.ts).
let secretName = (v: unknown) => {
  let s = text(v, 'name')
  if (!SECRET_NAME.test(s)) {
    throw new Error(
      'name: the app reads it as env.NAME, so letters, digits and ' +
        'underscores, not starting with a digit — WEATHER_KEY',
    )
  }
  return s
}

// Every secret door needs the platform's Cloudflare token, because a secret
// lives on the app's script and nowhere the platform itself keeps anything.
// Without it there is no half-measure to take, so this is a refusal and not
// a warning the way a deploy's is (dispatch.ts NEEDS_TOKEN).
let needsToken = (ctx: Ctx) => {
  if (!ctx.env.CF_WORKERS_TOKEN) {
    throw new Error(
      'the platform has no Cloudflare token to reach app workers with ' +
        "(CF_WORKERS_TOKEN) — secrets live on the app's own script, so " +
        'there is nowhere to put one until it is set',
    )
  }
}

// The space the caller means when they name none: the one that is THEIRS.
// Signing in mints it, so this is one lookup and never a question; a person
// who signed in before that existed, or who was invited into somebody else's
// space before they ever had one, gets theirs on this very call (T-32482,
// T-33142). Belonging to a space is not having one — defaulting to a space
// the caller is only a member of aimed app_install at the INVITER's space.
//
// Naming the APP is naming the space — the one they can reach that holds
// that slug. An app's own tool (declared.ts) knows its store and asks
// nothing, so the generic tier asking a member of two spaces to also name
// one read as the platform forgetting what it had just been told (C-32730
// item 6). Two spaces holding the same slug is the one genuine question, and
// only then are the names said.
let ownSpace = async (ctx: Ctx, app?: unknown) => {
  if (typeof app == 'string' && app) {
    let holding: Space[] = []
    for (let space of await ctx.dir.spaces(ctx.person)) {
      // An app in the trash does not hold its slug against a live one
      // (erase.ts, T-34430): it answers nothing anywhere else, and a person
      // who deleted their `garden` should not be asked which garden they
      // meant. It is still reachable by naming its space, which is what
      // `app_restore` says when two of them spell one slug.
      let here = await ctx.dir.app(space, app)
      if (here && !here.trashed) holding.push(space)
    }
    if (holding.length == 1) return holding[0]
    if (holding.length > 1) {
      throw new Error(
        `space: name one of ${
          holding.map((s) => s.slug).join(', ')
        } — each has an app ${app}`,
      )
    }
  }
  let owned = await ctx.dir.spaces(ctx.person, 'owner')
  if (owned.length > 1) {
    throw new Error(
      `space: name one of ${owned.map((s) => s.slug).join(', ')}`,
    )
  }
  return owned[0] ?? await ctx.dir.own(ctx.person)
}

// The caller in the space: a member reads, an owner or editor writes.
let inSpace = async (ctx: Ctx, args: Args, write = false) => {
  let space = args.space == null
    ? await ownSpace(ctx, args.app)
    : await ctx.dir.space(text(args.space, 'space'))
  if (!space) throw new Error(`no space ${args.space}`)
  let who: Who = {
    person: ctx.person,
    role: await ctx.dir.role(space, ctx.person),
  }
  if (!who.role) throw new Error(`not a member of ${space.slug}`)
  if (write && !writes(who.role)) {
    throw new Error(`not a writer of ${space.slug}`)
  }
  return { space, who }
}

// The caller as the space's OWNER: who belongs is the owner's to say. An
// editor writes the data and the files; they do not hand out keys.
let owns = async (ctx: Ctx, args: Args) => {
  let { space, who } = await inSpace(ctx, args, true)
  if (who.role != 'owner') throw new Error(`not the owner of ${space.slug}`)
  return { space, who }
}

export let inApp = async (ctx: Ctx, args: Args, write = false) => {
  let { space, who } = await inSpace(ctx, args, write)
  let slug = text(args.app, 'app')
  let app = await ctx.dir.app(space, slug)
  if (!app) throw new Error(`no app ${slug} in ${space.slug}`)
  return {
    space,
    app,
    who,
    store: appStore(ctx.env.STORE, space, app),
  }
}

// The caller as the space's OWNER, on one of its apps. Offering an app to the
// whole platform is the space's act, not one its editors make: an editor
// writes the app's files, and publishing hands the code to strangers.
let ownsApp = async (ctx: Ctx, args: Args) => {
  let it = await inApp(ctx, args, true)
  if (it.who.role != 'owner') {
    throw new Error(`not the owner of ${it.space.slug}`)
  }
  return it
}

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
    throw new Error(
      `${space.slug}/${app.slug} is not published — the gallery shows what ` +
        'people can install, so app_publish it first (or app_publish(app, ' +
        'gallery: true), which does both)',
    )
  }
  if (onGallery(app) == 'listed') return onGallery(app)
  if (!ctx.env.SESSION_SECRET) {
    throw new Error('the platform cannot sign a gallery link here')
  }
  let owner = await ctx.dir.nameAt(ctx.person) ?? space.slug
  let secret = ctx.env.SESSION_SECRET
  // The letter FIRST, the mark second: an ask nobody was told about is an app
  // waiting on a decision no one was asked to make, and it would sit there
  // saying so on the space page forever. A letter that will not send leaves
  // the row exactly as it was, and asking again is the whole retry.
  try {
    await mail(ctx.env)(galleryLetter({
      title: app.title,
      about: app.published.about,
      url: url(space, app),
      owner,
      yes: galleryDoor(await ticketFor(app, true, secret)),
      no: galleryDoor(await ticketFor(app, false, secret)),
    }))
  } catch {
    throw new Error(
      `${space.slug}/${app.slug} is published, but the gallery could not be ` +
        'asked: the letter that carries the decision would not send. ' +
        'Nothing was changed — ask again, or leave it offered without being ' +
        'shown',
    )
  }
  await askGallery(ctx.env, app)
  return 'asked' as const
}

// What every app in the space declares as its OWN, in app order, oldest
// first — the routing table a deploy reads to find a word's home (T-32728).
// A store's `/vocab` answers only the words it homes, so a use never looks
// like a second declaration and the first entry here is always the home.
let vocabs = async (ctx: Ctx, space: Space, app: App) => {
  let all = await ctx.dir.apps(space)
  if (!all.some((a) => a.eid == app.eid)) all = [...all, app]
  let read = await Promise.all(all.map(async (one) => {
    let r = await storeOf(ctx.env.STORE, storeName(space, one))('/vocab')
    if (!r.ok) {
      await r.body?.cancel()
      return [one.slug, {} as Vocab] as const
    }
    return [one.slug, await r.json() as Vocab] as const
  }))
  return new Map(read)
}

// Where each word of the space LIVES, oldest app first — the first app to
// declare a word is its home (T-32728), and a word THIS app already declares
// stays its own, because a store's vocabulary is additive forever. `said` is
// every app's manifest beside it, since growing a home means writing the
// home's whole manifest back.
let homesIn = async (ctx: Ctx, space: Space, app: App) => {
  let said = await vocabs(ctx, space, app)
  let homes: Homes = {}
  for (let [slug, cols] of said) {
    if (slug == app.slug) continue
    for (let [name, one] of Object.entries(cols)) {
      if (name in homes || name in (said.get(app.slug) ?? {})) continue
      homes[name] = { at: slug, cols: one }
    }
  }
  return { said, homes }
}

// The app's data files, as text (seed.ts) — the seed ones for a release, the
// ones a path names for store_load. Only the picked ones are read: an app's
// bytes are its pictures as well as its pages, and neither caller has any
// business decoding those.
let texts = async (
  blobs: Blobs,
  space: Space,
  app: App,
  pick: (path: string) => boolean,
): Promise<Text[]> => {
  let prefix = fileKey(space, app, '')
  let paths = own((await blobs.list(prefix)).map((k) => k.slice(prefix.length)))
    .filter(pick)
  return await Promise.all(paths.map(async (path) => ({
    path,
    text: new TextDecoder().decode(await blobs.get(prefix + path)),
  })))
}

// A seed batch through the app's own write door, as the caller: the refusal's
// own sentence back where the store said no, null where it took the batch.
// `check` is @yaks/api's dry run — every phase, then a rollback — which is how
// the refused bundle is found (seed.ts `blamed`).
let applying =
  (store: Door, head: Record<string, string>): Applying =>
  async (batch, check) => {
    let r = await store(`/apply${check ? '?check=1' : ''}`, {
      method: 'POST',
      body: JSON.stringify(batch),
    }, head)
    let body = await r.text()
    if (r.ok) return null
    try {
      return (JSON.parse(body) as { message?: string }).message ?? body
    } catch {
      return body
    }
  }

// `map {header: column}` as one argument: its SHAPE, checked once, so a model
// that sent a list or a nested object hears that rather than a header that
// silently went nowhere. Whether a mapped name is a column is csv.ts's, which
// is where the header it came from is still known.
let mapping = (v: unknown): Record<string, string> | undefined => {
  if (v == null) return undefined
  if (typeof v != 'object' || Array.isArray(v)) {
    throw new Error('map: {"Serves how many": "serves"}')
  }
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([header, col]) => [
      header,
      text(col, `map[${JSON.stringify(header)}]`),
    ]),
  )
}

// What a CSV is read AS (csv.ts): the component a row becomes, and the type
// each of its columns takes. The words are the platform's own plus this app's,
// in the five-scalar short form a store answers its own words in (vocab.ts
// `shortOf`) — an app declares scalars, and a core column that is a reference
// or a closed set holds the text a cell has anyway.
let sheetOf = async (
  store: Door,
  as: string,
  map?: Record<string, string>,
): Promise<Sheet> => {
  let mine = shortOf(appDoc(await answer(await store('/vocab'))))
  let words: Record<string, Cols> = {}
  for (let doc of coreDocs) Object.assign(words, shortOf(doc))
  Object.assign(words, mine)
  if (!(as in words)) {
    throw new Error(
      `as: ${as} is not a component — this app says ${
        Object.keys(mine).sort().join(', ') || 'none of its own yet'
      }, beside the platform's own words (doc, task, comment, …)${TEACH}`,
    )
  }
  return { as, cols: words[as], map }
}

// The head a write into an app's store wears when the platform makes it for
// somebody: the caller vouched for, and their name, so the rows carry their
// byline instead of the platform's (session.ts `titling`).
let byCaller = async (ctx: Ctx, who: Who) => ({
  ...vouched(who),
  ...await titling(ctx.dir, who.person),
})

// Whether a manifest can land on this app AT ALL, asked before anything moves
// (app_update). The same two rules a deploy holds it to, both of which throw
// rather than answer: a word another app in the space homes keeps that home's
// column types (store/vocab.ts `homed`), and this app's own columns keep the
// types their rows were written under (`grow`). Neither writes, so a refusal
// leaves the app exactly as it was — code included.
let fits = async (
  ctx: Ctx,
  space: Space,
  app: App,
  store: Door,
  source: string,
) => {
  let split = homed(parseVocab(source), (await homesIn(ctx, space, app)).homes)
  let r = await store('/vocab')
  let mine = r.ok ? await r.json() as Vocab : {}
  grow(mine, split.mine)
}

// A RELEASE, whichever door asked for it — app_deploy, app_install,
// app_update. The app's files are already live; this is everything else a
// version means: the components its vocab.json declares planted where the
// space says each word lives, the tools its tools.json declares handed to the
// store, its worker.js uploaded to the dispatch namespace, and the version
// moved on — recorded as a version of its own (versions.ts), so app_rollback
// can put this release back later. The answer is every line said BENEATH the
// door's own sentence.
let released = async (
  ctx: Ctx,
  space: Space,
  app: App,
  who: Who,
  store: Door,
) => {
  // Whatever door asked for this release wrote the app's bytes before asking
  // — app_files, a rollback's restore, an install's copy — so the edge is
  // emptied here, once, for all four (cache.ts `purged`). First, because a
  // release that dies on a manifest it refuses still leaves the bucket
  // changed, and the stale edge would outlive the failure.
  await purged(ctx.env, app)
  // What this release will be called, read here because the seed below is
  // marked with it the moment it lands and the version row is written at the
  // end.
  let version = (app.version ?? 0) + 1
  // The app's own components, if it declares any. A manifest the store
  // refuses fails the release: the words and the tables must agree, and a
  // half-planted vocabulary is what `unknown component` is made of.
  let key = fileKey(space, app, 'vocab.json')
  let blobs = r2Blobs(ctx.env.BLOBS)
  let planted: string[] = []
  let dropped: string[] = []
  // What this manifest MOVED, which naming the components does not say: a
  // renamed column arrives beside the old one, and the old one keeps every
  // row already written under it (C-32652 item 4).
  let added: string[] = []
  let kept: string[] = []
  // And the words this app USES rather than homes (T-32728).
  let uses: Record<string, string> = {}
  // The manifest as WRITTEN, which is where a kind says it is one and what it
  // means — the store keeps the short form of its words (graph.ts) and neither
  // survives the round trip. It is what the tools below are generated from.
  let manifest: VocabDoc = {}
  if (await blobs.has(key)) {
    let source = new TextDecoder().decode(await blobs.get(key))
    let next = parseVocab(source)
    manifest = appDoc(source)
    // One word, one home: a word another app in the space already declares is
    // that app's, so this release records a USE of it instead of planting a
    // second table, and any column it adds grows the HOME's.
    let { said, homes } = await homesIn(ctx, space, app)
    let split = homed(next, homes)
    uses = split.uses
    // The home's table grows first: a use whose column the home does not have
    // yet is not a use anyone can write until it does.
    for (let [slug, grown] of Object.entries(split.grows)) {
      let home = await ctx.dir.app(space, slug)
      if (!home) continue
      let whole: Vocab = { ...said.get(slug) }
      for (let [name, cols] of Object.entries(grown)) {
        whole[name] = { ...whole[name], ...cols }
        for (let col of Object.keys(cols)) added.push(`${name}.${col}`)
      }
      await answer(
        await storeOf(ctx.env.STORE, storeName(space, home))('/vocab', {
          method: 'POST',
          body: JSON.stringify(whole),
        }, vouched(who)),
      )
    }
    let mine = JSON.parse(
      await answer(
        await store('/vocab', {
          method: 'POST',
          body: JSON.stringify(split.mine),
        }, vouched(who)),
      ),
    )
    planted = mine.comps ?? []
    dropped = mine.dropped ?? []
    added = [...added, ...(mine.added ?? [])]
    kept = mine.kept ?? []
    await answer(
      await store('/uses', {
        method: 'POST',
        body: JSON.stringify(uses),
      }, vouched(who)),
    )
  }
  // And the data the app comes with (seed.ts, T-34327), AFTER the words it is
  // written in — an app's own components seed like the platform's — and once
  // per store: `app.seeded` is the mark, so a redeploy leaves what the person
  // has changed since exactly as they left it. It writes through the app's
  // ordinary door as the caller, so the rows carry their byline and nothing
  // server-owned can ride in on a seed file.
  let sowed: Sown[] = []
  if (!app.seeded) {
    sowed = await sow(
      await texts(blobs, space, app, seedy),
      applying(store, await byCaller(ctx, who)),
    )
    if (sowed.length) {
      await ctx.dir.apply({
        entities: [{
          entity: { eid: app.eid },
          seeded: { at: new Date().toISOString(), version },
        }],
      }, vouched(who))
    }
  }
  // And the app's own MCP tools (tools.json, T-32685), read the same way and
  // after the components, since a tool may write a word this very release
  // planted. The manifest is replaced whole — a declaration holds no rows —
  // so an app that deleted its tools.json releases none.
  let toolsKey = fileKey(space, app, 'tools.json')
  let sent = await blobs.has(toolsKey)
    ? new TextDecoder().decode(await blobs.get(toolsKey))
    : '{}'
  // A `view` names a page in the app's OWN files (T-32687), so this is the one
  // thing about the manifest the store cannot check: it holds the words, the
  // blobs hold the pages. A view nobody deployed would be a tool whose answer
  // renders nothing, which is worse than a refusal.
  let missing: string[] = []
  for (let file of viewsOf(sent)) {
    if (!await blobs.has(fileKey(space, app, file))) missing.push(file)
  }
  if (missing.length) {
    throw new Error(
      `tools.json: ${missing.join(', ')} — a view names a page in this ` +
        "app's own files; deploy the page beside index.html",
    )
  }
  // And the manifest is CHECKED here, against the words this app has after the
  // release above: a tool writing a component nobody declared is refused where
  // the vocabulary can be read. The store keeps a declaration as written
  // (graph.ts `/tools`) — a store that parsed its own tools would be a second
  // vocabulary inside the object, and the one that plants the words is the one
  // that can say which they are.
  // Either spelling of the manifest says the same words (vocab.ts `appDoc`),
  // and a tool is checked against the NAMES, so that is all this reads.
  let words = Object.fromEntries(
    Object.keys(
      appDoc(JSON.parse(await answer(await store('/vocab')))).$defs ?? {},
    ).map((name) => [name, {}]),
  ) as Vocab
  let borrows = JSON.parse(await answer(await store('/uses'))) as Record<
    string,
    string
  >
  // And the two tools every KIND this app declares is worth (kinds.ts,
  // T-34513), beside whatever the manifest said: an app that declared a recipe
  // and no tools.json still has a verb for putting one in and one for finding
  // it again, which is how the next agent discovers the app at all.
  let checked = withKinds(
    parseTools(sent, { ...words, ...borrowed(borrows) }),
    manifest,
    `${space.slug}/${app.slug}`,
  )
  let tooled = JSON.parse(
    await answer(
      await store('/tools', {
        method: 'POST',
        body: JSON.stringify(checked),
      }, vouched(who)),
    ),
  )
  let declared: string[] = tooled.tools ?? []
  // A tool list that moved is news to every agent connected who can reach
  // this app, and so is a view list that did — each said with its own
  // list_changed, since a release can move one without the other
  // (declared.ts, T-32686, T-33004).
  //
  // A moved VOCABULARY is the same news (T-34153): graph_apply's input schema
  // IS the caller's words, so a component planted or a column grown here
  // changed the tool list of everyone in the space, whether or not this app
  // declares a tool at all.
  let grown = !!(added.length || dropped.length)
  await moved(ctx, space, [
    ...(tooled.changed || grown ? ['tools' as const] : []),
    ...(tooled.views ? ['resources' as const] : []),
  ])
  // And the app's OWN code, if it wrote any (dispatch.ts, T-32778): the
  // worker.js among its files becomes its script in the dispatch namespace,
  // and an app that deleted its worker.js loses the script it had, so what
  // serves is what the files say. Without the platform's Cloudflare token
  // there is nothing to upload with — the files are already live, so the
  // release stands and says what is missing rather than failing (T-32781).
  //
  // What goes up is worker.js AND everything it imports (`carried`, T-34263):
  // a worker compiled to wasm is a `.wasm` beside the `.js` that instantiates
  // it, and a script missing a module does not link at all.
  let workerKey = fileKey(space, app, WORKER)
  let ran = ''
  let worker = ''
  if (!(await blobs.has(workerKey))) {
    if (ctx.env.CF_WORKERS_TOKEN) await drop(ctx.env, storeName(space, app))
  } else if (!ctx.env.CF_WORKERS_TOKEN) ran = `\n${NEEDS_TOKEN}`
  else {
    worker = await upload(
      ctx.env,
      storeName(space, app),
      await carried((path) => blobs.read(fileKey(space, app, path))),
    )
    ran = '\nworker: worker.js answers first; a 404 from it serves the files'
  }
  // What this release IS, kept so one word puts it back (T-32886): the files
  // as a manifest of path to the name of their bytes, those bytes pinned
  // beside them, and Cloudflare's name for the script this uploaded. The
  // app's version counter and the row that records the version move together.
  let prefix = fileKey(space, app, '')
  let pinned = await snapshot(blobs, prefix)
  await record(ctx.dir, blobs, prefix, who, app, version, pinned, worker)
  // What the versions before this one broke is closed by this one: the code
  // that produced it is not what serves any more (unseen.ts `healed`,
  // D-32318 §Errors). The release already happened, so a store that cannot be
  // asked leaves the breaks open rather than failing a deploy that is live.
  let closed = 0
  try {
    closed = await healed(ctx.env, space, app, who, version)
  } catch { /* the files are out; an open break is the softer wrong */ }
  // A published app's OFFER does not move with a deploy: publishing is the
  // owner's deliberate act and pins the version strangers install, so an
  // editor's deploy must not change what the whole platform gets. Silence
  // was the bug (T-33146) — installers kept taking v1 while v2 served and
  // nothing said so — and the fix is that the deploy door says it.
  let offer = app.published
  let trailing = offer && offer.version < version
    ? `\noffered as ${offer.name} is still v${offer.version}, so anyone ` +
      'installing it gets that code — app_publish again to offer this one'
    : ''
  return {
    version,
    said: ran +
      trailing +
      (closed
        ? `\nclosed ${closed} ${
          closed == 1 ? 'break' : 'breaks'
        } from earlier versions`
        : '') +
      (declared.length
        ? `\ntools: ${declared.map((t) => `${app.slug}__${t}`).join(', ')}`
        : '') +
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
      // What to DO about a column the manifest stopped naming, which the bare
      // list never said: the board that read "5.2 mi in null min" was a
      // rename nobody was told to finish (C-32730 item 4).
      (kept.length
        ? `\nkept, not in vocab.json (the rows are there): ${
          kept.join(', ')
        } — name it in vocab.json again to keep writing it, or move its ` +
          'rows to the new word yourself, a row at a time with graph_query ' +
          'then graph_apply. Nothing is migrated behind you.'
        : '') +
      (dropped.length ? `\ndropped (no rows): ${dropped.join(', ')}` : ''),
  }
}

// One app's code copied ONTO another's, which is what an install is and what
// an update is again: every file of the source written under the target's own
// prefix, and every file the target has that the source does not, gone — so
// what serves after is what the publisher wrote, and nothing of a version
// before it lingers. What the platform keeps beside an app's files travels
// with neither (versions.ts `own`): `blobs/` is where a page's own bytes land
// (apps.ts `blobKey`) — a photo somebody picked, the app's DATA — and
// `versions/` is one app's own deploy history, which the copy earns for
// itself on the release that follows.
let copied = async (
  ctx: Ctx,
  from: { space: Space; app: App },
  onto: { space: Space; app: App },
) => {
  let blobs = r2Blobs(ctx.env.BLOBS)
  let there = fileKey(from.space, from.app, '')
  let here = fileKey(onto.space, onto.app, '')
  let paths = (keys: string[], prefix: string) =>
    own(keys.map((k) => k.slice(prefix.length)))
  let code = paths(await blobs.list(there), there)
  let had = paths(await blobs.list(here), here)
  for (let path of code) {
    await blobs.put(here + path, await blobs.get(there + path))
  }
  let gone = had.filter((p) => !code.includes(p))
  for (let path of gone) await blobs.delete(here + path)
  return { wrote: code, gone }
}

// Every store this call reaches. An app named is that one store, as it always
// was; no app is the FEDERATED read (T-32698) — every app in every space the
// caller belongs to, or in the space they named, since an entity spans apps
// and only the whole set can compose it. What "reach" means is membership
// plus the app's own access: the door remembers nothing about which apps a
// session has opened (declared.ts), so a public app in a space the caller is
// not in is on the web and not here.
//
// And the trash is out of reach, whichever row wears the word (erase.ts,
// T-34430, T-34431). This is the same answer `reachable` gives the ROSTER, and
// the two have to agree: a deleted app that still turned up in the passage
// `about` and `initialize` put at the top of an agent's context would be an
// app the agent goes on filing things in after the person threw it away.
// Naming one is the way back to it — `app_restore` and `space_restore`, and
// any tool that names the app explicitly, take the early return above.
export let inReach = async (ctx: Ctx, args: Args): Promise<Reach[]> => {
  if (args.app != null) {
    let { space, app, who } = await inApp(ctx, args)
    return [{ space, app, who }]
  }
  let spaces = args.space == null
    ? await ctx.dir.spaces(ctx.person)
    : [(await inSpace(ctx, args)).space]
  let out: Reach[] = []
  for (let space of spaces) {
    if (space.trashed) continue
    let who: Who = {
      person: ctx.person,
      role: await ctx.dir.role(space, ctx.person),
    }
    if (!who.role) continue
    for (let app of await ctx.dir.apps(space)) {
      if (!app.trashed && reads(mode(app.access), who.role)) {
        out.push({ space, app, who })
      }
    }
  }
  return out
}

let answer = async (r: Response) => {
  let body = await r.text()
  if (!r.ok) throw new Error(body)
  return body
}

type Change = { eid: string; name: string; comp: unknown }

// A file's key: the app's slugs, then its path from the slash (apps.ts keyOf).
let fileKey = (space: Space, app: App, path: string) =>
  `${space.slug}/${app.slug}/${path.replace(/^\/+/, '')}`

/**
 * Bytes into an app's files, and the edge emptied once after the last one —
 * the write half of app_files, with no tool call in it, because bytes arrive
 * by other doors too: a zip somebody dropped on their space's page carries
 * pictures (drop.ts, T-34230), and `sandbox_ship` carries what a compiler
 * made (T-34264). Neither is `content: string` — a `.wasm` would not survive
 * a decode — which is why this takes BYTES. Answers the paths as the app
 * serves them.
 */
export let wrote = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  files: { path: string; bytes: Uint8Array }[],
) => {
  let blobs = r2Blobs(env.BLOBS)
  let prefix = fileKey(space, app, '')
  // The one file with a ceiling of its own (standing.ts): AGENTS.md is read
  // on every connection by every agent that can reach the app, so it is
  // refused over the cap here — at the write, whichever door brought the
  // bytes — rather than truncated at the read.
  for (let f of files) {
    let no = tooLong(f.path, f.bytes.byteLength)
    if (no) throw new Error(no)
  }
  // What each path held goes into its own history first, pinned by its content
  // (versions.ts `replaced`, T-34508), so the bytes about to be replaced can be
  // put back. Before the put, per file, because after it they are gone: a
  // deploy is the release a person names, and this is the twenty minutes
  // between two of them, where the page somebody was using gets overwritten.
  let at = new Date()
  for (let f of files) {
    let path = fileKey(space, app, f.path).slice(prefix.length)
    await replaced(blobs, prefix, path, who.person ?? '', at)
    await blobs.put(prefix + path, f.bytes)
  }
  // One purge for the whole batch, after the last byte lands: the tag is the
  // app, not the file, so writing ten files empties the edge once (cache.ts
  // `tagsOf`).
  await purged(env, app)
  let paths = files.map((f) => fileKey(space, app, f.path).slice(prefix.length))
  // What these bytes replaced is closed by them (unseen.ts `rewrote`,
  // T-34338), the way a release closes what the versions under it broke. The
  // bytes are already out, so a store that cannot be asked leaves the breaks
  // open rather than failing a write that landed.
  try {
    await rewrote(env, space, app, who, paths)
  } catch { /* the files are out; an open break is the softer wrong */ }
  return paths
}

/**
 * What a write says about the bytes it stored: how many there are, their
 * sha256, and — for a `.json` file — whether they parse.
 *
 * A model writes a file by transcribing it, and a long one comes out with a
 * bracket run miscounted. Answering the measurement in the same call that
 * made the file means the mistake is caught where it was made, instead of
 * once the app is served broken (T-34337). The sha is what a second write
 * is compared against, and the byte count is what a hand-counted file is.
 */
export let stored = (path: string, bytes: Uint8Array, sha: string) =>
  `${bytes.byteLength} bytes, sha256 ${sha}` +
  (path.endsWith('.json') ? `, ${parses(bytes)}` : '')

// A `.json` file's verdict. The parse error carries its own position, which
// is the whole reason to say it here: "at position 45971" names the bracket,
// and nothing else in the answer could.
export let parses = (bytes: Uint8Array) => {
  try {
    JSON.parse(new TextDecoder().decode(bytes))
    return 'parsed'
  } catch (e) {
    return `NOT valid JSON — ${(e as Error).message}`
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
  throw new Error(
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
 * https only: an app is made of bytes somebody can vouch for. The ceiling is
 * the platform's own (apps.ts MAX), refused on the `content-length` before
 * the body is read and again on the body itself, since a header is a claim.
 */
export let fetched = async (said: string) => {
  let at: URL
  try {
    at = new URL(said)
  } catch {
    throw new Error(`url: ${said} is not a URL`)
  }
  if (at.protocol != 'https:') {
    throw new Error(`url: https only, not ${at.protocol.replace(':', '')}`)
  }
  let big = (n: number) => `${at} is ${size(n)} — ${size(MAX)} at most`
  let r = await fetch(at)
  if (!r.ok) throw new Error(`${at} answered ${r.status}`)
  let claim = Number(r.headers.get('content-length') ?? 0)
  if (claim > MAX) throw new Error(big(claim))
  let bytes = new Uint8Array(await r.arrayBuffer())
  if (bytes.byteLength > MAX) throw new Error(big(bytes.byteLength))
  return {
    bytes,
    // What the response said it is, without its parameters. An app serves
    // the file by its PATH (files.ts mimeOf), so this is a fact about where
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
 * One of these tools, run as this caller. The drop door (drop.ts) is a PAGE
 * doing what an agent does — make the app, write its files, release it — and
 * this is how it does exactly that rather than a second spelling of it:
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
 * A BUILD holds its own `spend` and pays for the whole thing when it ends,
 * destroying the container with it (builder.ts). A lone connector call arrives
 * with none, mints one, and pays for its own seconds here — leaving the
 * container to sleep on its own (sandbox.ts `SLEEP`), because the person may
 * well call again in a moment and a fresh container is a fresh `cargo build`.
 */
let bench = async <T>(
  ctx: Ctx,
  space: Space,
  body: (box: Box) => Promise<T>,
): Promise<T> => {
  let spend = ctx.spend ?? spending()
  let box = boxOf(ctx.env, space, ctx.person, spend)
  try {
    return await body(box)
  } finally {
    if (!ctx.spend) {
      await paid(spend, (s) => countedSandbox(ctx.env, space, s))
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

// A path this may hand to a shell for globbing: what a path and a glob are
// made of, and nothing a shell reads as punctuation. It is tidiness rather
// than a boundary — the sandbox is the caller's own and sandbox_exec runs
// anything in it — and it keeps one `ls` from becoming three commands.
let SHIP = /^[A-Za-z0-9._\-/*?[\]]+$/

let shipPath = (v: unknown) => {
  let said = text(v, 'paths')
  if (!SHIP.test(said) || said.split('/').includes('..')) {
    throw new Error(
      `paths: ${said} — a path inside the sandbox, e.g. pkg/app.wasm or ` +
        'pkg/*.js',
    )
  }
  return said
}

// Where that path IS: from the sandbox's working directory, or as written
// where a model wrote an absolute one. There is nowhere to escape to — the
// sandbox is the caller's own and sandbox_exec reaches all of it — so this is
// about `/workspace//workspace/x`, not about a boundary.
let inBox = (path: string) => path.startsWith('/') ? path : `${CWD}/${path}`

// The bytes of a file read out of the container. base64 whatever it is: a
// .wasm is not text and would not survive being decoded as text (files.ts
// serves it by its extension either way).
let unbase64 = (said: string) =>
  Uint8Array.from(atob(said.trim()), (c) => c.charCodeAt(0))

// What an app's access means where it is felt: what happens when the person
// sends someone the link. Said on every tool that sets it, so the agent can
// repeat it and the person is never surprised by who can act on their app.
let told = (access: Access | null) =>
  access == 'open'
    ? 'anyone with the link can use it, signed in or not'
    : access == 'private'
    ? 'only its members can see it; member_add mails an invitation to one'
    : 'anyone with the link can see it; only its members can change it'

// The inviter's own message, where they sent one (T-32963): a line or two
// saying what this is, carried at the top of the invitation. A paragraph, not
// a newsletter — an invitation mails an address the SENDER chose, so free text
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
    throw new Error(
      `note: ${said.length} characters, and a note is at most ${NOTE} — ` +
        'a line or two saying what this is, not a newsletter',
    )
  }
  return said
}

// Their words, marked as theirs: quoted the way a letter quotes, so a reader
// can tell what the person wrote from what the platform did.
let quoted = (said: string) =>
  said.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')

// How many of these one person gets in an hour. A few is plenty: feedback is
// a person noticing something, not a stream, and the fourth in an hour is
// far likelier to be an agent in a loop than a fourth thing wrong.
let HOURLY = 3

// And how many a caller who has not signed in gets: one, shared by every such
// caller, because there is no identity to hand an allowance to. Harder on
// purpose — a stranger's report is wanted, a loop's is a mailbox full — and
// still a pause rather than a no, since the refusal says where to write.
let STRANGERS = 1

// What this person has already said this hour, out of the meta store itself
// rather than a counter in some isolate — three per hour only means anything
// if it holds across the isolate a call lands in. A store that cannot answer
// counts nothing: a rate limit is never the reason feedback is lost.
//
// Nobody signed in spells `.created.by=` on the line, which the filter grammar
// reads as ABSENT — so the bucket for a stranger is every report nobody
// signed, which is exactly the anonymous ones.
let recently = async (ctx: Ctx) => {
  try {
    return (await meta(ctx.env).query(
      `.report!&.created.by=${ctx.person}&.report.at>=1-hour-ago`,
    )).length
  } catch {
    return 0
  }
}

// The views a tool's answer draws itself in — `ui://` resources the door
// serves from public/apps.html and public/errors.html (mcp.ts) and the host
// renders in an iframe.
export let APPS_VIEW = 'ui://yaks/apps'
export let ERRORS_VIEW = 'ui://yaks/errors'

// The type a view is served under: text/html with the profile the MCP Apps
// spec requires, which is how a host tells a page it renders from a page it
// merely reads. An app's own view (declared.ts, T-32687) wears the same one.
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

// What a host is told ABOUT a view, beside its bytes.
//
// `domain` is the origin the host gives the page its own sandbox subdomain
// from — one per site, so two spaces' views never share an origin — and it is
// MANDATORY for a plugin that ships UI
// (developers.openai.com/plugins/reference). `csp` is the exact set of places
// the page reaches for, which the submission checklist requires as well
// (developers.openai.com/plugins/deploy/submission). Declaring neither is what
// ChatGPT stamps "CSP off" on and what leaves the widget failing to load at
// all (T-34433).
//
// Both are said twice on purpose. The standard `ui` surface is the spec's;
// the `openai/*` aliases beside it are the older spelling ChatGPT still reads,
// snake_case and all, and a host that knows both reads `ui` first. And the
// whole thing rides on the resource in `resources/list` AND on each content
// item of `resources/read` — the content item is what governs the iframe the
// host actually builds (spec 2026-01-26 §Resources).
export let uiMeta = (domain: string, csp: Csp = {}) => ({
  ui: { domain, csp },
  'openai/widgetDomain': domain,
  'openai/widgetCSP': {
    connect_domains: csp.connectDomains ?? [],
    resource_domains: csp.resourceDomains ?? [],
  },
})

// The pages the `guide` tool offers, said two ways: the names alone for the
// argument, and a name with its few words for the description, which is where
// an agent chooses one (guide.ts `brief`).
let SLUGS = PAGES.map((p) => p.slug).join(', ')
let COVERING = PAGES.map((p) => `${p.slug} (${p.brief})`).join(', ')

export let TOOLS: Tool[] = [
  {
    name: 'space_new',
    title: 'A new space',
    destructive: false,
    description:
      'Another corner of yaks.app, at <slug>.yaks.app, with the person as its ' +
      'owner. They already have one from signing in, and every other tool ' +
      'uses it without being told — so this is only for a second address.',
    input: {
      type: 'object',
      properties: { slug: str('the hostname label'), title: str('its name') },
      required: ['slug', 'title'],
    },
    run: async (ctx, args) => {
      let s = slug(args.slug, 'slug')
      // A grant narrowed to one space reaches that space and no other
      // (grants.ts `narrowed`), and a space it made would be a space outside
      // it. Said here because minting one is the single act that does not go
      // through the directory's membership at all.
      if (ctx.who?.space) {
        throw new Error(
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
        throw new Error(
          mine
            ? `${s} is in the trash, ${
              daysLeft(taken.trashed!)
            } days left — space_restore(space: '${s}') brings it back whole, ` +
              'and after 30 days the platform erases it and frees the address'
            : `space ${s} is taken`,
        )
      }
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
            doc: { title: text(args.title, 'title') },
            space: { slug: s },
          },
          {
            entity: { eid: '$seat' },
            member: { space: '$space', person: ctx.person, role: 'owner' },
          },
        ],
      }, vouched({ person: ctx.person, role: 'owner' }))
      let space = (await ctx.dir.space(s))!
      return {
        text: `space ${s} (${space.eid}): https://${s}.yaks.app/`,
        space,
      }
    },
  },
  {
    name: 'space_delete',
    title: 'Close a space',
    destructive: true,
    description:
      'Close a space: it goes to the trash for 30 days. Every app in it ' +
      'stops answering, its address stops serving and its apps leave your ' +
      'tools — but nothing is erased, the address is held, and space_restore ' +
      'brings the whole space back within those 30 days. After that the ' +
      'platform erases it: the apps, everything they saved, their files, any ' +
      'domain aimed at them, and the address goes back into circulation. YOU ' +
      "CANNOT DO THIS: it mails the space's owner a link that does it, " +
      'lasting an hour, and answers with what that link would stop. Read ' +
      'that back to them and tell them to check their email — it is theirs ' +
      'to confirm, not yours. Only the owner of the space may ask, and ' +
      'app_delete is the smaller thing when they mean one app. Pass forever: ' +
      'true and the link erases it there and then instead, with nothing kept ' +
      'and no undo — only when the person has said they mean exactly that.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        forever: {
          type: 'boolean',
          description:
            'true to mail a link that erases the space on the spot instead ' +
            'of trashing it: its apps, everything they saved, their files ' +
            'and its address, all gone, with no restore. Only when the ' +
            'person has said they mean exactly that',
        },
      },
      required: ['space'],
    },
    run: async (ctx, args) => {
      // Naming the space is required here and optional everywhere else: a
      // tool that guesses which space to destroy from context is a tool that
      // one day guesses wrong (`ownSpace`), and it costs the agent one word
      // it already knows.
      let { space } = await owns(ctx, {
        ...args,
        space: slug(args.space, 'space'),
      })
      let no = refused(space)
      if (no) throw new Error(no)
      let forever = args.forever != null && flag(args.forever, 'forever')
      if (space.trashed && !forever) {
        throw new Error(
          `${space.slug} is already in the trash, ${
            daysLeft(space.trashed)
          } days left — space_restore(space: '${space.slug}') brings it back, ` +
            'or space_delete(forever: true) mails a link that erases it now',
        )
      }
      if (!ctx.env.SESSION_SECRET) {
        throw new Error('the platform cannot sign a confirmation link here')
      }
      // Where the letter goes: the address this caller signs in with, which
      // is an owner's — never one the agent named, so nothing an agent says
      // can point this letter at somebody else.
      let to = await ctx.dir.emailAt(ctx.person)
      if (!to) throw new Error('we have no address to write to you at')
      let d = await doomed(ctx.dir, space)
      // What the link would do, in the words of the act it carries: `forever`
      // names what is destroyed, the trash names what stops (erase.ts).
      let bullets = (lines: string[]) => lines.map((l) => `  - ${l}`).join('\n')
      let said = bullets(forever ? naming(d) : keeping(d))
      let link = door(
        space.slug,
        await ticket(space, ctx.person, ctx.env.SESSION_SECRET, forever),
      )
      // A letter that will not send is not a link to hand over (member_add
      // does that for an invitation, which is not an irreversible act): the
      // web door is said instead, and it still wants their cookie, their
      // ownership and the name typed back. That door TRASHES whatever was
      // asked for here — the erase rides in the ticket, and the ticket was in
      // the letter that did not arrive — so what it would do is said in the
      // trash's words however this call was made.
      try {
        await mail(ctx.env)({ to, ...letter(d, link, forever) })
      } catch {
        throw new Error(
          'the confirmation letter could not be sent. They can still put the ' +
            `space in the trash themselves, signed in, at ${
              door(space.slug)
            } — which asks them to type ${space.slug} back. That would stop:\n` +
            bullets(keeping(d)),
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
    title: 'Take a space out of the trash',
    destructive: false,
    idempotent: true,
    description:
      'Bring back a space that was deleted. Every app in it serves again at ' +
      'the address it always had, their tools and pages come back, and ' +
      'everything they saved is exactly as it was — nothing was touched ' +
      'while it sat in the trash. Within 30 days of the delete being ' +
      'confirmed; after that the space has been erased and there is nothing ' +
      "to bring back. Unlike space_delete this is the assistant's to do: " +
      'putting a space back is not an act anybody needs protecting from.',
    input: {
      type: 'object',
      properties: { space: SPACE },
      required: ['space'],
    },
    run: async (ctx, args) => {
      let { space, who } = await owns(ctx, {
        ...args,
        space: slug(args.space, 'space'),
      })
      if (!space.trashed) {
        throw new Error(
          `${space.slug} is not in the trash — it is serving at ` +
            `https://${space.slug}.yaks.app/`,
        )
      }
      await untrashSpace(ctx.env, ctx.dir, space, who)
      return {
        text: `${space.slug} is back: https://${space.slug}.yaks.app/ serves ` +
          'again and its apps are yours again. Everything they saved is ' +
          'where it was.',
        space,
      }
    },
  },
  {
    name: 'app_new',
    title: 'A new app',
    destructive: false,
    description:
      'Start a new app — the thing you are making for the person. It lives at ' +
      '<space>.yaks.app/<slug>/ and the first app in a space also answers the ' +
      'bare address. Then app_files to write index.html, app_deploy to ' +
      'release, and give them the link. Pass access when the app is for other ' +
      "people too: 'open' if anyone with the link should be able to act on it " +
      "— vote, add a line, sign up — and 'private' if only they and whoever " +
      'they invite (member_add) should see it at all.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        slug: str('the path label'),
        title: str('its name'),
        access: ACCESS,
      },
      required: ['slug', 'title'],
    },
    run: async (ctx, args) => {
      let { space, who } = await inSpace(ctx, args, true)
      let s = slug(args.slug, 'slug')
      // The free tier's app ceiling (T-32758), at the one door that adds one.
      // An app costs money to keep, so this is a refusal and not a warning —
      // the warning came at 80%, on the unseen channel (unseen.ts `ceiling`).
      let free = ceilings(space.tier)
      // What the space HAS: an app in the trash is one the person has already
      // said they are done with, so it stands against nothing (erase.ts).
      let apps = (await ctx.dir.apps(space)).filter((a) => !a.trashed)
      if (free && apps.length >= free.apps) {
        throw new Error(atCeiling(space, 'apps'))
      }
      let taken = await ctx.dir.app(space, s)
      if (taken) {
        // The slug is held for a trashed app for its whole thirty days
        // (erase.ts): a second app born here is the one thing a restore
        // could not put back, so this address is not free until the person
        // says which of the two they want.
        throw new Error(
          taken.trashed
            ? `${s} is in the trash in ${space.slug}, ${
              daysLeft(taken.trashed)
            } days left — app_restore(app: '${s}') brings it back, or ` +
              `app_delete(app: '${s}', forever: true) erases it and frees ` +
              'the address'
            : `app ${s} exists in ${space.slug}`,
        )
      }
      // An address an app has LEFT still points at it (app_set below), so it
      // is not free for a new app either.
      let moved = await ctx.dir.former(space, s)
      if (moved) {
        throw new Error(
          `${s} is where ${space.slug}/${moved.slug} used to be, and still ` +
            'points there — pick another slug',
        )
      }
      // The birth address is the name of the app's store, pinned here so a
      // later rename moves the address and not the data (directory.ts
      // storeName). It is `former` and not `alias` because that word is every
      // store's now (@yaks/alias, T-34390).
      let entities: EntityLiteral[] = [{
        entity: { eid: '$app' },
        doc: { title: text(args.title, 'title') },
        app: {
          slug: s,
          space: space.eid,
          version: 0,
          access: args.access == null ? 'public' : access(args.access),
        },
        former: { slug: bornAt(space, s) },
      }]
      // Being first claims nothing (T-33040). Until somebody says which app
      // is the front page, the space's bare hostname lists the apps its
      // visitor may open; which app opens there is a choice, and arrival
      // order is not a choice anyone made. Said in the answer, because
      // nothing else tells a person the front page is theirs to set.
      let front = await ctx.dir.home(space)
      await ctx.dir.apply({ entities }, vouched(who))
      let app = (await ctx.dir.app(space, s))!
      return {
        text: `app ${space.slug}/${s} (${app.eid}): ${url(space, app)}` +
          ` — ${told(app.access)}. https://${space.slug}.yaks.app/ ${
            front ? `opens ${front.slug}` : "lists the space's apps"
          } — app_set(app, home: true) makes this one the front page there`,
        space,
      }
    },
  },
  {
    name: 'app_files',
    title: "The app's files",
    destructive: true,
    openWorld: true,
    description:
      "Write the app's files — index.html and any css, js or images beside " +
      'it — or list them, read one back, or delete one. Write a whole app in ' +
      'ONE call with files: [{path, content}, …] — a files batch IS the ' +
      'write, so leave op out; path and content write a ' +
      'single file, and base64 in place of content writes one that is not ' +
      'text — a picture, or the .wasm a worker.js imports. They serve live at ' +
      '<space>.yaks.app/<app>/<path>; index.html answers the directory. Keep ' +
      'what the app remembers in its own store, never localStorage: the page ' +
      'reads and writes it with `import { apply, query, search } from ' +
      "'./api/client.js'`, which is served beside the app. Write every " +
      "address relative: the kernel gives each page a `<base>` at the app's " +
      'own address, so nothing in an app names the app, and a copy someone ' +
      'installs at another address still works. Every write answers what it ' +
      'stored — the byte count and the sha256, and for a .json file whether ' +
      'it parses, naming the position when it does not — so a miscounted ' +
      'bracket is caught in the call that made it. AGENTS.md beside ' +
      'index.html is what the person wants followed whenever anyone works on ' +
      'this app — recipes in grams, one photo each — and every agent who can ' +
      'reach the app is told it at the start of every conversation; write ' +
      'one whenever they state a rule like that, and keep it under 4 KB. It ' +
      "is the app's inside, like vocab.json: never served on the web, read " +
      'back here. op: patch with path, find ' +
      'and replace edits one file in place: find is exact and must match ' +
      'exactly once. op: fetch with path and url writes an https response ' +
      'body to path, which is how a library is vendored without transcribing ' +
      'it, and answers an integrity hash for it. Nothing a write or a delete ' +
      'takes away is lost: each keeps the bytes it replaced for 30 days, ' +
      'op: history with path lists them newest first — sha256, size, when it ' +
      'was replaced and by whom — and op: restore with path puts one back, ' +
      'the newest by default or the one sha or at names. A restore is itself ' +
      'a write, so it too can be undone. Call guide for the whole of ' +
      'it, in a page (https://yaks.app/guide.md).',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        op: {
          type: 'string',
          enum: [...OPS],
          description:
            'what to do; leave it out when passing files, which is a write',
        },
        path: str('the file path, e.g. index.html'),
        content: str('the file text, for write'),
        base64: str(
          'the file BYTES, base64, instead of content — for a file that is ' +
            'not text, such as the .wasm a worker.js imports',
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
          'for fetch: the https address whose body is written to path — a ' +
            'library vendored into the app rather than transcribed',
        ),
        sha: str(
          'for restore: the sha256 of the version to put back, off op ' +
            'history. Left out with at, the newest is put back',
        ),
        at: str(
          'for restore: put the file back to what it was at this moment — ' +
            '2026-09-06T14:20:00Z',
        ),
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: str('the file path'),
              content: str('the file text'),
              base64: str('the file bytes, base64, instead of content'),
            },
            required: ['path'],
          },
          description: 'several files to write at once, instead of ' +
            'path and content — the whole app in one call',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let batch = files(args.files)
      let op = opOf(args, batch.length)
      // The refusal names the ops AND the batch, because a bare "op is
      // required" leaves an agent guessing at both (C-32624 item 5).
      if (!OPS.includes(op)) {
        throw new Error(
          `op: one of ${OPS.join(', ')} — write takes path and content, or ` +
            'files: [{path, content}] for several at once',
        )
      }
      let { space, app, who } = await inApp(ctx, args, WRITES.includes(op))
      let blobs = r2Blobs(ctx.env.BLOBS)
      let prefix = fileKey(space, app, '')
      if (op == 'list') {
        let keys = await blobs.list(prefix)
        // The app's OWN files: what the platform keeps beside them — the
        // bytes a page uploaded, the bytes a version pins — is addressed by
        // its content and was never a file anyone wrote (versions.ts `own`).
        return {
          text: own(keys.map((k) => k.slice(prefix.length))).join('\n') ||
            '(no files)',
          space,
        }
      }
      if (op == 'read' || op == 'delete') {
        let key = fileKey(space, app, text(args.path, 'path'))
        if (!(await blobs.has(key))) throw new Error(`no file ${args.path}`)
        let path = key.slice(prefix.length)
        if (op == 'read') {
          return { text: new TextDecoder().decode(await blobs.get(key)), space }
        }
        // A delete takes bytes away like a write does, so it keeps them the
        // same way: the file is in its own history the moment it stops being a
        // file, and op restore brings it back (T-34508).
        await replaced(blobs, prefix, path, who.person ?? '')
        await blobs.delete(key)
        await purged(ctx.env, app)
        return {
          text: `deleted ${path} — app_files(app: '${app.slug}', op: ` +
            `'restore', path: '${path}') brings it back`,
          space,
        }
      }
      // What this file has been (T-34508). Every write pins what it replaced,
      // so a path answers its own past — and `now` is at the top because "what
      // is there this second" is half of what somebody reading a history is
      // trying to work out.
      if (op == 'history') {
        let path = fileKey(space, app, text(args.path, 'path'))
          .slice(prefix.length)
        let all = await history(blobs, prefix, path)
        let live = await blobs.read(prefix + path)
        return {
          text: [
            `${path} in ${space.slug}/${app.slug}:`,
            live
              ? `now — ${size(live.byteLength)}, sha256 ${await sha256(live)}`
              : 'now — no file there',
            ...await Promise.all(
              all.map(async (w) =>
                `- until ${w.at} — ${size(w.size)}, sha256 ${w.sha}, by ${
                  (w.by && await ctx.dir.nameAt(w.by)) || w.by || 'someone'
                }`
              ),
            ),
            all.length
              ? `app_files(app: '${app.slug}', op: 'restore', path: ` +
                `'${path}') puts back the newest of those; sha or at names ` +
                'another'
              : 'Nothing has replaced it, so there is nothing to put back.',
          ].join('\n'),
          space,
        }
      }
      // And putting one back, as a NEW write — so the bytes it replaces are
      // themselves kept, and a restore can be undone by another.
      if (op == 'restore') {
        let path = fileKey(space, app, text(args.path, 'path'))
          .slice(prefix.length)
        let all = await history(blobs, prefix, path)
        if (!all.length) {
          throw new Error(
            `no history for ${path} in ${space.slug}/${app.slug} — nothing ` +
              'has replaced it, so what is there is what there has been',
          )
        }
        let want = args.sha != null
          ? all.find((w) => w.sha == text(args.sha, 'sha'))
          : args.at != null
          ? held(all, when(text(args.at, 'at')).getTime())
          : all[0]
        if (!want) {
          throw new Error(
            args.sha != null
              ? `no ${args.sha} in ${path}'s history — op history lists what ` +
                'it keeps'
              : `${path} has not been written since ${args.at}, so what is ` +
                'there is already what it was then',
          )
        }
        let bytes = await blobs.read(pinned(prefix, want.sha))
        if (!bytes) {
          throw new Error(
            `${path}'s bytes from ${want.at} are no longer kept — the history ` +
              'goes back 30 days',
          )
        }
        let [p] = await wrote(ctx.env, space, app, who, [{ path, bytes }])
        return {
          text: `put ${p} back to what it was until ${want.at} → ` +
            `${url(space, app)}${p} — ${
              stored(p, bytes, want.sha)
            }. This is itself a write, so op history now has the bytes it ` +
            'replaced.',
          space,
        }
      }
      // A read-modify-write of one file, in one call: the loop an agent that
      // miscounted a bracket in a 46 KB file had no cheap way to run.
      if (op == 'patch') {
        let path = text(args.path, 'path')
        let key = fileKey(space, app, path)
        if (!(await blobs.has(key))) throw new Error(`no file ${path}`)
        // Empty is a legal replacement — it is how a line is removed — so
        // this asks for a string rather than for something.
        if (typeof args.replace != 'string') {
          throw new Error('replace is required (the empty string removes)')
        }
        let now = new TextEncoder().encode(patched(
          new TextDecoder().decode(await blobs.get(key)),
          text(args.find, 'find'),
          args.replace,
          key.slice(prefix.length),
        ))
        let [p] = await wrote(ctx.env, space, app, who, [{ path, bytes: now }])
        return {
          text: `patched ${p} → ${url(space, app)}${p} — ${
            stored(p, now, await sha256(now))
          }`,
          space,
        }
      }
      // A library vendored, rather than a minified file transcribed by hand.
      if (op == 'fetch') {
        let path = text(args.path, 'path')
        let got = await fetched(text(args.url, 'url'))
        let [p] = await wrote(ctx.env, space, app, who, [{
          path,
          bytes: got.bytes,
        }])
        let sha = await sha256(got.bytes)
        return {
          // The integrity hash so a page that goes on loading this from a
          // CDN can be pinned to the very bytes we got; the mime is what the
          // response claimed, and mimeOf(path) is what the app will serve.
          text:
            `fetched ${args.url} → ${url(space, app)}${p} — ${
              stored(p, got.bytes, sha)
            }${got.mime ? `, ${got.mime}` : ''}, integrity sha256-${sri(sha)}` +
            (mimeOf(p) == 'application/octet-stream'
              ? ' — the app serves it as application/octet-stream; give the ' +
                'path a known extension to serve it as anything else'
              : ''),
          space,
        }
      }
      let sent = batch.length ? batch : [{
        path: text(args.path, 'path'),
        bytes: bytesOf(args),
      }]
      let paths = await wrote(ctx.env, space, app, who, sent)
      // What landed, per file: the measurement the caller checks its own
      // transcription against.
      let each = await Promise.all(
        sent.map(async (f, i) =>
          stored(paths[i], f.bytes, await sha256(f.bytes))
        ),
      )
      return {
        text: paths.length == 1
          ? `wrote ${paths[0]} → ${url(space, app)}${paths[0]} — ${each[0]}`
          : `wrote ${paths.length} files → ${url(space, app)}:\n` +
            paths.map((p, i) => `${p} — ${each[i]}`).join('\n'),
        space,
      }
    },
  },
  // The workbench (sandbox.ts, T-34264). Four tools, and they are here rather
  // than in a tier of their own because they are the platform's verbs like the
  // rest: an owner or editor of the space calls them, the builder we run calls
  // them through the same table (builder.ts `roster`), and a person's own
  // agent calls them over the connector.
  {
    name: 'sandbox_exec',
    title: 'Run a build command',
    destructive: true,
    openWorld: true,
    description:
      "Run one command in this space's build sandbox — a Linux container for " +
      'the things a browser cannot do for itself: compile something to ' +
      'WebAssembly, run a generator, minify an asset. Installed: Rust 1.98.1 ' +
      'with the wasm32-unknown-unknown target, wasm-bindgen 0.2.128 and ' +
      'wasm-opt 132; Python 3.13.15 with pip; Go 1.27.1; Zig 0.16.0, which is ' +
      'also the C and C++ compiler here — `zig cc -target wasm32-freestanding ' +
      '-nostdlib -Wl,--no-entry` gives a module a browser loads with no glue, ' +
      'and -target wasm32-wasi one a WASI shim runs; Deno 2.9.1, and the Node ' +
      'and Bun the base image ships. Anything else installs FOR THE SESSION: ' +
      'the command runs as root, so `apt-get install -y <pkg>` or a download ' +
      'works, and it costs the next build nothing. Write the source with ' +
      'sandbox_write, build it here, then sandbox_ship the artifact into the ' +
      'app. An app needs none of this — html, css and js run as they are, so ' +
      'reach for the sandbox only when something must be COMPILED. It is ' +
      'signed in as the person: `yaks` is ' +
      'installed and $YAKS_TOKEN and $YAKS_HOST are set, so `yaks <tool>` ' +
      'and curl reach these same tools from inside a script, and the token ' +
      'dies with the container. The container is metered: every second it ' +
      `is awake is charged to the space, and one build gets ${BUDGET} of ` +
      'them, so plan the build and run it once rather than poking at it. It ' +
      'is destroyed when the build ends, and everything in it with it.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        cmd: str('the command, run in a shell, e.g. cargo build --release'),
        cwd: str(`where to run it (default ${CWD})`),
        timeout: {
          type: 'number',
          description: `seconds to allow it (default and most, ${
            TIMEOUT / 1000
          })`,
        },
      },
      required: ['cmd'],
    },
    run: async (ctx, args) => {
      let { space } = await inSpace(ctx, args, true)
      let cmd = text(args.cmd, 'cmd')
      let asked = Number(args.timeout ?? 0) * 1000
      let out = await bench(ctx, space, (box) =>
        box.exec(cmd, {
          cwd: args.cwd == null ? CWD : text(args.cwd, 'cwd'),
          timeout: asked > 0 ? Math.min(asked, TIMEOUT) : TIMEOUT,
        }))
      return {
        text: `code ${out.exitCode}` +
          `\n\nstdout:\n${capped(out.stdout) || '(nothing)'}` +
          `\n\nstderr:\n${capped(out.stderr) || '(nothing)'}`,
        space,
      }
    },
  },
  {
    name: 'sandbox_write',
    title: 'Write a build file',
    // A path that already holds something is overwritten, which is the one
    // thing here that is not purely additive.
    destructive: true,
    idempotent: true,
    description:
      "Write one file inside this space's build sandbox — a Cargo.toml, a " +
      "src/lib.rs, whatever the build needs. These are NOT the app's files: " +
      'nothing here is served, and everything here is gone when the build ' +
      'ends. app_files writes what the app serves; sandbox_ship moves a built ' +
      'artifact from here to there. Waking the sandbox is metered by the ' +
      'second, like sandbox_exec.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        path: str(`the path in the sandbox, e.g. src/lib.rs (from ${CWD})`),
        content: str('the file text'),
      },
      required: ['path', 'content'],
    },
    run: async (ctx, args) => {
      let { space } = await inSpace(ctx, args, true)
      let path = shipPath(args.path)
      let content = text(args.content, 'content')
      await bench(
        ctx,
        space,
        (box) => Promise.resolve(box.writeFile(inBox(path), content)),
      )
      return { text: `wrote ${path} in the sandbox`, space }
    },
  },
  {
    name: 'sandbox_read',
    title: 'Read a build file',
    readOnly: true,
    description:
      "Read one file back out of this space's build sandbox — a generated " +
      'source, a build log, whatever the last command left behind. Waking the ' +
      'sandbox is metered by the second, like sandbox_exec.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        path: str(`the path in the sandbox, e.g. pkg/app.js (from ${CWD})`),
      },
      required: ['path'],
    },
    run: async (ctx, args) => {
      let { space } = await inSpace(ctx, args, true)
      let path = shipPath(args.path)
      let got = await bench(
        ctx,
        space,
        (box) => box.readFile(inBox(path)),
      )
      return { text: capped(got.content), space }
    },
  },
  {
    name: 'sandbox_ship',
    title: 'Ship a build artifact',
    destructive: true,
    openWorld: true,
    description:
      'Copy what the build made into the app, where it is served: name the ' +
      'files in the sandbox — pkg/*.wasm, pkg/*.js — and each lands beside ' +
      'index.html under its own name, as if app_files had written it. This ' +
      'is the last step of a compile: the sandbox is thrown away and the app ' +
      'keeps the artifact. Bytes are carried as bytes, so a .wasm arrives ' +
      'whole. Waking the sandbox is metered by the second, like sandbox_exec.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        paths: {
          type: 'array',
          items: str('a path or glob in the sandbox, e.g. pkg/*.wasm'),
          description: 'the files to copy in; a glob may name several',
        },
      },
      required: ['app', 'paths'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args, true)
      let asked = list(args.paths, 'paths').map(shipPath)
      if (!asked.length) throw new Error('paths: at least one file to copy in')
      let files = await bench(ctx, space, async (box) => {
        // One `ls` expands every glob at once, so a batch of artifacts costs
        // one command rather than one each.
        let found = await box.exec(`ls -1d -- ${asked.join(' ')}`, { cwd: CWD })
        let paths = found.stdout.split('\n').map((l) => l.trim()).filter(
          Boolean,
        )
        if (!paths.length) {
          throw new Error(
            `nothing in the sandbox matches ${asked.join(', ')} — ` +
              'sandbox_exec `ls` to see what the build left',
          )
        }
        return await Promise.all(paths.map(async (path) => ({
          // The app serves it under its own name: `pkg/app_bg.wasm` arrives
          // as `app_bg.wasm`, beside index.html, which is where a page's
          // relative import looks for it.
          path: path.split('/').pop()!,
          bytes: unbase64(
            (await box.readFile(inBox(path), { encoding: 'base64' }))
              .content,
          ),
        })))
      })
      let paths = await wrote(ctx.env, space, app, who, files)
      return {
        text: `shipped ${paths.length} ${
          paths.length == 1 ? 'file' : 'files'
        } → ${url(space, app)}: ${paths.join(', ')}`,
        space,
      }
    },
  },
  {
    name: 'app_deploy',
    title: 'Release a version',
    destructive: false,
    openWorld: true,
    description:
      'Release what you have written: the files are already live, so this is ' +
      'the mark that they are one version — the one an error will name. Do ' +
      'it when the app is ready to show, then give the person the URL. It ' +
      "also plants the components the app's vocab.json declares — " +
      `${EXAMPLE} — so the app gets typed components of its own. A word the ` +
      'platform already says is refused, the whole manifest at once and ' +
      'before anything is planted; one this manifest stops naming, and that ' +
      'holds no rows, goes. It answers the columns it ADDED and the ones the ' +
      'store still has that this manifest did not name — a column is never ' +
      'renamed or retyped, so a new spelling arrives beside the old one, ' +
      'which keeps every row already written under it. A seed.json beside ' +
      'index.html — a list of bundles, or a seed/ folder of *.json files when ' +
      "there is a lot of them — is written into the app's store here, once " +
      'per store and after the components, so the app opens with data in it; ' +
      'deploy again and nothing is seeded. A tools.json beside ' +
      'it gives the app its own MCP tools — ' +
      `${TOOLS_EXAMPLE} — listed here as <app>__<tool> for everyone who can ` +
      'reach the app, so the person and their agent act on the app through ' +
      "its own words. And a worker.js beside index.html becomes the app's " +
      'own server code: it answers every request that is not /api/ before ' +
      'the files do, and whatever it answers 404 falls through to them. ' +
      'Every deploy is kept, so app_rollback can put this one back later. ' +
      'If the app is published, the offer does NOT move with it — what ' +
      'strangers install stays the version you published until you ' +
      'app_publish again, and this says so when it starts trailing.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who, store } = await inApp(ctx, args, true)
      let { version, said } = await released(ctx, space, app, who, store)
      return {
        text:
          `deployed ${space.slug}/${app.slug} v${version}: ${url(space, app)}` +
          said,
        space,
      }
    },
  },
  // Bulk data that is not seed data (T-34392). The seed is the app's first
  // furniture and runs once; this is the same reading of the same files, asked
  // for on purpose, whenever a dataset needs to go in.
  {
    name: 'store_load',
    title: 'Load a data file into the store',
    destructive: false,
    description:
      "Write a data file the app already carries into the app's store, now. " +
      'path is one file — data/cities.json — or a folder, and then every ' +
      '*.json and *.csv under it goes in. A JSON file holds the same list of ' +
      'bundles a seed.json does and graph_apply takes: [{"entity": {"eid": ' +
      '"$a"}, "doc": {"title": "…"}}]. A CSV is a spreadsheet, and `as` names ' +
      'the component ONE ROW becomes — as: "city" with headers name,country ' +
      'writes city{name, country} per row, values coerced to the column ' +
      "types the vocabulary declares; `title` and `body` land in the row's " +
      "doc, an `id` (or `alias`) column is the row's NAME — alias{name}, " +
      'which lands on the entity already holding it, so loading the file ' +
      'again patches those rows instead of duplicating them and the name ' +
      'stands wherever an eid does, and map ' +
      '{"Serves how many": "serves"} renames a header that does not match a ' +
      'column. A header naming nothing is refused, as is a cell that will ' +
      'not coerce, both naming the row and the header. Together the files ' +
      'are ONE batch, read in filename order, so an alias minted in one file ' +
      'resolves in the next; if the store refuses a bundle nothing is ' +
      'written and the refusal names the file and the entry that caused it. ' +
      'This is how a big dataset arrives without being typed into a call: ' +
      'app_files(op: fetch) writes the https body into the app, store_load ' +
      'puts it in the store — two calls. Unlike a seed it is not once-only: ' +
      'call it whenever, and it patches and adds as the caller, so the rows ' +
      'carry your byline. It applies whatever the file says, deletes ' +
      'included — a bundle with $delete: true (or tombstone: {}) deletes ' +
      'that entity, and the store is the judge of whether you may. A bundle ' +
      'naming an eid patches that row; one naming a $alias mints a new ' +
      'entity each run — unless it carries alias: {name: "…"}, which lands ' +
      'on the entity already holding that name, so a file loaded twice is a ' +
      'patch and not a second copy.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        path: str(
          'the file to load — data/cities.json, data/cities.csv — or a ' +
            'folder, which loads every *.json and *.csv under it',
        ),
        as: str(
          'for a CSV: the component one row becomes — "city", or a platform ' +
            'word like "task". Its columns are the headers',
        ),
        map: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'headers that do not match a column, renamed: {"Serves how ' +
            'many": "serves"}. A header that matches needs no entry',
        },
      },
      required: ['app', 'path'],
    },
    run: async (ctx, args) => {
      let { space, app, who, store } = await inApp(ctx, args, true)
      let path = text(args.path, 'path')
      let files = await texts(
        r2Blobs(ctx.env.BLOBS),
        space,
        app,
        (p) => asked(path, p),
      )
      if (!files.length) {
        throw new Error(
          `no file ${path} in ${app.slug} — app_files(op: 'list') says what ` +
            'is there',
        )
      }
      let all = await load(
        loaded(
          files,
          args.as == null
            ? undefined
            : await sheetOf(store, text(args.as, 'as'), mapping(args.map)),
        ),
        applying(store, await byCaller(ctx, who)),
      )
      let names = [...new Set(all.map((s) => s.file))]
      return {
        text: `loaded ${all.length} ${
          all.length == 1 ? 'entity' : 'entities'
        } into ${space.slug}/${app.slug} from ${
          names.length > 6 ? `${names.length} files under ${path}` : (
            names.join(', ') || path
          )
        }`,
        space,
      }
    },
  },
  {
    name: 'app_versions',
    title: 'Deploy history',
    readOnly: true,
    description:
      'Every deploy of the app, newest first, with when it went out and what ' +
      'changed in it. Read it when the person says the app used to work, or ' +
      'before putting it back, so you name the version they mean. The app ' +
      'keeps its last 20.',
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
      return {
        text: [
          `${space.slug}/${app.slug}: ${all.length} ${
            all.length == 1 ? 'version' : 'versions'
          }`,
          ...all.map((v, i) => {
            // A version a rollback made says so first: "restored v2" is what
            // the person asked for, and the file list is how it did it.
            let back = restored(all, i)
            return `- v${v.version}${
              v.version == app.version ? ' (live)' : ''
            }${v.version == app.published?.version ? ' (offered)' : ''}${
              v.at ? ` ${v.at}` : ''
            } — ${back ? `restored v${back}, ` : ''}${
              whatChanged(all[i + 1]?.files ?? null, v.files)
            }`
          }),
        ].join('\n'),
        space,
      }
    },
  },
  {
    name: 'app_rollback',
    title: 'Roll back a release',
    destructive: true,
    openWorld: true,
    description:
      'Put the app back the way it was — every file of an earlier deploy, ' +
      'its components, its tools and its own code with them. This is the ' +
      'answer when the person says a change broke something or asks for it ' +
      'back; you do not need to remember what you wrote. It goes out as a ' +
      'NEW version, so nothing is lost and a rollback can itself be rolled ' +
      'back. Leave version out for the deploy before the live one, or name ' +
      'one off app_versions. Give the person the URL and tell them what came ' +
      'back. Their data is never touched — only the files.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        version: {
          type: 'number',
          description:
            'the version to go back to, off app_versions; left out, the one ' +
            'before the live one',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who, store } = await inApp(ctx, args, true)
      let all = await versions(ctx.dir, app)
      let want: Version | undefined
      if (args.version == null) {
        // The one BEFORE the live one: the deploy that broke the page is the
        // newest, so "put it back" means the one under it.
        want = all[1]
        if (!want) {
          throw new Error(
            `${space.slug}/${app.slug} has ${
              all.length ? 'only one deploy' : 'no deploys'
            } — there is nothing earlier to go back to`,
          )
        }
      } else {
        let n = Number(args.version)
        want = all.find((v) => v.version == n)
        if (!want) {
          throw new Error(
            `no v${args.version} of ${space.slug}/${app.slug} — it keeps ${
              all.map((v) => `v${v.version}`).join(', ') || 'none'
            }`,
          )
        }
      }
      let blobs = r2Blobs(ctx.env.BLOBS)
      let prefix = fileKey(space, app, '')
      let now = await manifest(blobs, prefix)
      await restore(blobs, prefix, want.files)
      // A rollback IS a release — of files that were live once — so the same
      // door plants the vocabulary, the tools and the worker this version
      // pinned, and records it as a NEW version. History is never rewritten.
      let { version, said } = await released(ctx, space, app, who, store)
      return {
        text: `put ${space.slug}/${app.slug} back to v${want.version}, live ` +
          `now as v${version}: ${url(space, app)} — ${
            whatChanged(now, want.files)
          }` + said,
        space,
      }
    },
  },
  // The store's own way back (recover.ts, T-34507). It sits beside
  // app_rollback because the two are the same word said about the two halves an
  // app is made of: a rollback puts the FILES back, this puts the DATA back.
  {
    name: 'store_restore',
    title: 'Put a store back to a moment',
    destructive: true,
    description:
      'Put everything the app has saved back to how it was at a moment — the ' +
      'whole store, every row of it, as of that time. This is the answer when ' +
      'a write went wrong and the person wants their data back: a bad import, ' +
      'rows deleted that should not have been, a change that turned out to be ' +
      'the wrong one. Cloudflare keeps the last 30 days of the store, so any ' +
      'moment in those 30 days can be asked for; at is that moment, as a time ' +
      '(2026-09-06T14:20:00Z). Call it with no at first: it says the oldest ' +
      'moment still available and every restore already made. It is ' +
      'REVERSIBLE — where the store stood before is written down before ' +
      'anything moves, so a restore is undone by restoring again to a moment ' +
      'just before it, and the answer hands you that exact sentence. What it ' +
      'costs is what was written since the moment asked for, so name the ' +
      'moment as late as it can be. The app is briefly restarted to pick the ' +
      "recovery up. The app's FILES are not part of this — app_rollback and " +
      'app_files restore put those back.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        at: str(
          'the moment to put the store back to, within the last 30 days — ' +
            '2026-09-06T14:20:00Z. Left out, this answers the window and the ' +
            'restores already made instead of restoring anything',
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
        (r) => stamp(ctx.env, { entities: recorded(app.eid, r) }),
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
    name: 'app_set',
    title: 'Rename or reshare an app',
    destructive: false,
    idempotent: true,
    description:
      'Rename an app, change its title, or change who may use it. The title ' +
      'is what it is called; the slug is its address, so changing it moves ' +
      'the app to <space>.yaks.app/<new>/ — its files and everything it has ' +
      'saved come with it, and the old address redirects to the new one, so ' +
      'a link someone already has still works. Give the person the new link. ' +
      'access is the same choice app_new takes: set it ' +
      "to 'open' when they want everyone with the link to be able to act on " +
      "the app, 'private' to shut it to everyone but its members. home makes " +
      "this app the space's front page — what <space>.yaks.app/ opens, the " +
      'app someone lands on when they are given the space itself. The first ' +
      'app made in a space is it until someone says otherwise, so set it ' +
      'when the app they care about was not the first one; home false leaves ' +
      'the space with no front page. Only the space owner may move it. first ' +
      "is the front page's own routing: the paths its worker.js answers " +
      'BEFORE the app whose name owns them, as globs — ["/recipes/*"] sends ' +
      'every address under /recipes/ to the front page instead of the recipes ' +
      'app. Leave it alone unless the front page is meant to route the whole ' +
      'space; an empty list puts every path back where it was. gallery is ' +
      'whether a published app is put forward for https://yaks.app/gallery, ' +
      'the public page of apps made here: true asks, false takes it back at ' +
      'once. Only when the person has said which they want.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        slug: str('the new path label, to move the app'),
        title: str('the new name'),
        access: ACCESS,
        home: {
          type: 'boolean',
          description:
            'true to make this app what <space>.yaks.app/ opens — it is ' +
            'served AT that address, and its own /<app>/ forwards there; ' +
            'false to leave the space with no front page, where that ' +
            'address lists the apps a visitor may open',
        },
        first: {
          type: 'array',
          items: { type: 'string' },
          description:
            'the path globs the front page answers before the apps that own ' +
            'them, e.g. ["/recipes/*", "/*/print"]; [] to route nothing ' +
            'first. Only the front page routes, so pass home: true with it ' +
            'unless this app is already one. The platform keeps /login, ' +
            "/connect, /mcp and every app's /api/ door, so a glob naming one " +
            'is refused',
        },
        gallery: {
          type: 'boolean',
          description: 'true to put this published app forward for ' +
            'https://yaks.app/gallery — it appears there once yaks.app ' +
            'agrees; false to take it off, or withdraw the ask, at once',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args, true)
      let title = args.title == null ? null : text(args.title, 'title')
      let to = args.slug == null ? null : slug(args.slug, 'slug')
      let open = args.access == null ? null : access(args.access)
      let home = args.home == null ? null : flag(args.home, 'home')
      // The globs are checked BEFORE anything is written or any file moves:
      // a refusal here has to leave the app exactly as it was (router.ts).
      let first = args.first == null ? null : globs(args.first, [META.app])
      let show = args.gallery == null ? null : flag(args.gallery, 'gallery')
      if (
        title == null && to == null && open == null && home == null &&
        first == null && show == null
      ) {
        throw new Error(
          'nothing to change: pass title, slug, access, home, first, ' +
            'gallery, or all',
        )
      }
      // Being SHOWN is the space owner's, the way publishing is: an editor
      // writes the app, and putting it on our own front page is not that.
      if (show != null && who.role != 'owner') {
        throw new Error(`not the owner of ${space.slug}`)
      }
      // Which app the bare hostname opens is the SPACE's, not this app's:
      // everyone who is given the space lands there, so it is the owner's
      // to move, the way publishing and membership are (`ownsApp` above).
      if (home != null && who.role != 'owner') {
        throw new Error(`not the owner of ${space.slug}`)
      }
      let moving = to != null && to != app.slug
      if (moving && await ctx.dir.app(space, to!)) {
        throw new Error(`app ${to} exists in ${space.slug}`)
      }
      // The address it leaves keeps answering, as a permanent redirect to the
      // new one: a page already open on a phone writes to the old address for
      // as long as it stays open, and a link someone was given is forever
      // (C-32574 item 4, where a rename broke every open tab in silence).
      // A `former` slug resolves like an id, and the BIRTH address is already
      // the primary one (app_new pins it), so only a later move adds a word.
      let left = bornAt(space, app.slug)
      let keeping = moving && !app.slugs.includes(left)
        ? [...app.slugs.slice(1), left].join(' ')
        : null
      // Files first and in that order — copy, then rename, then delete — so
      // whichever address is the app's at any moment has the whole app
      // behind it. Its store is untouched: it is named for where the app was
      // born, not where it lives (directory.ts storeName).
      let blobs = r2Blobs(ctx.env.BLOBS)
      let from = fileKey(space, app, '')
      let onto = moving ? `${space.slug}/${to}/` : from
      let keys = moving ? await blobs.list(from) : []
      for (let key of keys) {
        await blobs.put(onto + key.slice(from.length), await blobs.get(key))
      }
      let entities: EntityLiteral[] = []
      if (title != null || moving || open || keeping) {
        entities.push({
          entity: { eid: app.eid },
          ...(title == null ? {} : { doc: { title } }),
          ...(moving || open
            ? {
              app: {
                ...(moving ? { slug: to! } : {}),
                ...(open ? { access: open } : {}),
              },
            }
            : {}),
          ...(keeping ? { former: { slugs: keeping } } : {}),
        })
      }
      // The globs are COLUMNS of the word that says which app is home
      // (vocab.ts), so an app that is not the front page has nowhere to put
      // them — and routing another app's paths from a page nobody is served
      // is a rule that would never fire. Said rather than silently kept.
      if (first?.length && home == false) {
        throw new Error('a front page routes first; home: false routes nothing')
      }
      if (first != null && home == null && !app.home) {
        throw new Error(
          `${space.slug}/${app.slug} is not the front page — ` +
            'app_set(app, home: true) makes it one, and it routes from there',
        )
      }
      // Moving the front page is one batch that takes the word off the app
      // that had it and puts it on this one, which is what keeps a space to
      // one (directory.ts `homing`). The write empties the directory's cache,
      // so the hostname answers the new front page on the next request rather
      // than a TTL later. `home: false` is about THIS app: a space whose front
      // page is some other app keeps the one it has.
      if (home == false) {
        if (app.home) entities.push(...homing(app, null))
      } else if (home || first != null) {
        entities.push(
          ...homing(await ctx.dir.home(space), app, first),
        )
      }
      await ctx.dir.apply({ entities }, vouched(who))
      for (let key of keys) await blobs.delete(key)
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
        }: ${url(space, now)}${
          moving ? ` (moved from /${app.slug}/, which now redirects here)` : ''
        }${open ? ` — ${told(open)}` : ''}${
          // What the app IS now, off the row just read back: `home: false` on
          // an app that was never the front page changes nothing, and saying
          // it did would be a sentence the address disagrees with.
          home == null || now.home == app.home
            ? ''
            : now.home
            ? ` — it is the front page now: https://${space.slug}.yaks.app/ ` +
              'opens it'
            : ` — no longer the front page: https://${space.slug}.yaks.app/ ` +
              "lists the space's apps again until another one is set home"}${
          // Read off the row that was just written, never off what arrived:
          // the sentence says what the app IS now (directory.ts `appOf`).
          first == null
            ? ''
            : now.first.length
            ? ` — it answers ${
              now.first.join(', ')
            } before the apps that own them`
            : ' — it answers no path before the app that owns it'}${
          shown ? ` — ${saying(shown)}` : ''
        }`,
        space,
      }
    },
  },
  {
    name: 'app_secret_set',
    title: 'Set a worker key',
    destructive: false,
    idempotent: true,
    description:
      "Give the app's worker a key for an outside service — an API key, a " +
      'token — without the page ever holding it. The value goes onto the ' +
      "app's own script and NOWHERE else: it is not saved in the app's data, " +
      'not in its history, and no tool, this one included, can ever read it ' +
      'back. Only the worker can, as env.NAME, so name it the way its code ' +
      "will spell it: app_secret_set(app, name: 'WEATHER_KEY', value) and " +
      'then `fetch(url, {headers: {authorization: env.WEATHER_KEY}})` in ' +
      'worker.js. Ask the person for the value; never invent one. Setting a ' +
      'name that is already there replaces it. The app needs a worker.js ' +
      '(app_deploy uploads it) for the secret to reach any code.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        name: str('the name the worker reads it as, e.g. WEATHER_KEY'),
        value: str('the secret itself — it is never answered back'),
      },
      required: ['app', 'name', 'value'],
    },
    run: async (ctx, args) => {
      let { space, app } = await inApp(ctx, args, true)
      let name = secretName(args.name)
      // The value is read and never held anywhere else: no `text(...)` echo
      // in a refusal, and nothing about it in the answer.
      if (typeof args.value != 'string' || !args.value) {
        throw new Error('value is required')
      }
      needsToken(ctx)
      await setSecret(ctx.env, storeName(space, app), name, args.value)
      return {
        text: `${space.slug}/${app.slug}: ${name} is set — worker.js reads ` +
          `it as env.${name}, and nothing can read it back`,
        space,
      }
    },
  },
  {
    name: 'app_secret_list',
    title: 'The worker keys',
    readOnly: true,
    description:
      "The names of the keys the app's worker can read. Values are never " +
      'answered — by this tool or any other. Use it to see what a worker.js ' +
      'may spell as env.NAME.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app } = await inApp(ctx, args)
      needsToken(ctx)
      let names = await secrets(ctx.env, storeName(space, app))
      return {
        text: names.length
          ? `${space.slug}/${app.slug}: ${
            names.join(', ')
          } — worker.js reads ` +
            'each as env.NAME; no value is ever answered'
          : `${space.slug}/${app.slug} has no secrets`,
        space,
      }
    },
  },
  {
    name: 'app_secret_remove',
    title: 'Remove a worker key',
    destructive: true,
    idempotent: true,
    description:
      "Take a key away from the app's worker. Its code stops seeing " +
      'env.NAME at the next request; nothing else about the app changes.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP, name: str('the secret to remove') },
      required: ['app', 'name'],
    },
    run: async (ctx, args) => {
      let { space, app } = await inApp(ctx, args, true)
      let name = secretName(args.name)
      needsToken(ctx)
      await dropSecret(ctx.env, storeName(space, app), name)
      return { text: `${space.slug}/${app.slug}: ${name} removed`, space }
    },
  },
  {
    name: 'app_delete',
    title: 'Throw an app away',
    destructive: true,
    description:
      'Throw an app away: it goes to the trash for 30 days. Its address ' +
      'stops answering, its tools and pages leave you, and it stops being ' +
      'the front page — but its files, everything it saved and its slug are ' +
      'all kept, and app_restore brings the whole app back within those 30 ' +
      'days. After that the platform erases it for good. Only when the ' +
      'person asks for the app to be deleted; app_files delete removes one ' +
      'file, and app_set moves an app rather than replacing it. Pass ' +
      'forever: true to skip the trash and erase it now — for the person ' +
      'who means it, since nothing is kept and there is no undo.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        forever: {
          type: 'boolean',
          description:
            'true to erase it now instead of trashing it: its files, ' +
            'everything it saved and its address, all gone, with no restore. ' +
            'Only when the person has said they mean exactly that',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args, true)
      // The directory lives in the meta space's own app: deleting it would
      // take every space, app and membership with it, so it is not an app to
      // throw away, whoever owns `yak`.
      if (space.slug == META.space && app.slug == META.app) {
        throw new Error(`${META.space}/${META.app} is the platform itself`)
      }
      let forever = args.forever != null && flag(args.forever, 'forever')
      if (!forever) {
        if (app.trashed) {
          throw new Error(
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
            `${url(space, app)} stops answering and it has left your tools; ` +
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
      await moved(ctx, space, [
        ...(Object.keys(had).length ? ['tools' as const] : []),
        ...(Object.values(had).some((t) => t.view)
          ? ['resources' as const]
          : []),
      ])
      return {
        text: `deleted ${space.slug}/${app.slug}: ${wrote} ${
          wrote == 1 ? 'file' : 'files'
        }, everything it saved, and ${url(space, app)} — all gone`,
        space,
      }
    },
  },
  {
    name: 'app_restore',
    title: 'Take an app out of the trash',
    destructive: false,
    idempotent: true,
    description:
      'Bring back an app that was deleted. It serves again at the address it ' +
      'always had, its tools and pages come back, and everything it saved is ' +
      'exactly as it was — nothing was touched while it sat in the trash. ' +
      'Within 30 days of app_delete; after that it has been erased and there ' +
      'is nothing to bring back. app_list shows what is in the trash and how ' +
      'long each has left.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args, true)
      if (!app.trashed) {
        throw new Error(
          `${space.slug}/${app.slug} is not in the trash — it is serving at ${
            url(space, app)
          }`,
        )
      }
      await untrash(ctx.env, ctx.dir, space, app, who)
      return {
        text: `${space.slug}/${app.slug} is back: ${url(space, app)} serves ` +
          'again and its tools are yours again. Everything it saved is ' +
          'where it was.',
        space,
      }
    },
  },
  {
    name: 'app_errors',
    title: 'What is broken',
    destructive: false,
    idempotent: true,
    description:
      "Everything still broken in the app: what a page threw in someone's " +
      'browser, what a request threw on the way, and what the platform ' +
      'reported. Each is an entity in the app store. New ones also ride the ' +
      'end of your next reply, once. Pass `fixed` with the ids you have ' +
      'fixed and they are archived, which is what stops them showing here ' +
      'and there; pass `seen` to say the same about breaks you are done with ' +
      'without listing every id — `all`, `v3` for everything up to and ' +
      'including that deploy, or a day. It draws itself where the person can ' +
      'see it, with the same button on each break.',
    view: ERRORS_VIEW,
    // The view's fixed button calls this tool back to archive a break.
    visibility: ['model', 'app'],
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        fixed: {
          type: 'array',
          items: { type: 'string' },
          description:
            'ids of breaks that are fixed — each is archived and stops ' +
            'being listed. An id off a line here, or an eid.',
        },
        seen: {
          type: 'array',
          items: { type: 'string' },
          description:
            'breaks you are done with, whether or not you fixed them — the ' +
            'same archiving `fixed` does, said without listing ids. `all`, ' +
            '`v3` for everything up to and including that deploy, or a day ' +
            '(2026-08-14) or an instant for everything at or before it. Ids ' +
            'work here too, so one call can mix them.',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      // Two words for one act, because the two sentences differ: `fixed` is
      // "I have fixed these" — what the view's button says — and `seen` is
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
        ...seen.map(line),
      ]
      return {
        text: said.join('\n') || 'no open errors',
        space,
        data: {
          space: space.slug,
          app: app.slug,
          title: app.title,
          url: url(space, app),
          version: app.version ?? 0,
          errors: cards(seen),
        },
      }
    },
  },
  {
    name: 'app_stats',
    title: 'Who visited an app',
    readOnly: true,
    description:
      'How many people opened the app, and where they came from: visits a ' +
      'day for the last month, the pages they opened, the sites that linked ' +
      'to them, and the countries they were in. Aggregate counts and nothing ' +
      'else — there is no visitor here to identify, no address and no ' +
      'session, so this can never answer who someone was or what one person ' +
      'did. Reach for it when they ask whether anyone is reading the thing, ' +
      "or which page is worth working on. Only the app's own people may ask.",
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        days: {
          type: 'number',
          description:
            'how far back, in days (default 30). Cloudflare keeps three ' +
            'months, so anything past 90 is the same answer as 90.',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app } = await inApp(ctx, args)
      let days = args.days == null ? undefined : Number(args.days)
      // No token, no numbers — one sentence rather than an error, because
      // there is nothing the agent or the person can do about it (views.ts).
      let asked = statsOf(ctx.env, app.eid, days)
      if (!asked) return { text: NOT_ON, space, data: { on: false } }
      let seen = await asked
      let list = (head: string, rows: { name: string; views: number }[]) =>
        rows.length
          ? [`${head}:`, ...rows.map((r) => `- ${r.name} — ${r.views}`)]
          : []
      let text = seen.total
        ? [
          `${space.slug}/${app.slug} — ${seen.total} visits in ${seen.days} ` +
          `days (${url(space, app)})`,
          ...list('Pages', seen.pages),
          ...list('Came from', seen.from),
          ...list('Countries', seen.countries),
        ].join('\n')
        : `${space.slug}/${app.slug} — nobody has opened it in ${seen.days} ` +
          'days'
      return {
        text,
        space,
        data: {
          on: true,
          space: space.slug,
          app: app.slug,
          url: url(space, app),
          ...seen,
        },
      }
    },
  },
  {
    name: 'app_list',
    title: 'Every app they have',
    readOnly: true,
    description:
      'What the person already has here: every app in every space of theirs, ' +
      'with its address, the mailbox it sends and receives at, the version ' +
      'it is at, how many breaks are still open in it, which one is the ' +
      "space's front page, and what the month has cost against what the " +
      'space is allowed. Read it before making a second app, and when they ' +
      'ask what they have or where something lives. Anything deleted is ' +
      'listed under Trash with the days it has left, until app_restore ' +
      'brings it back or the 30 days run out.',
    view: APPS_VIEW,
    input: {
      type: 'object',
      properties: {
        space: str('one space to list; leave it out for all of theirs'),
      },
    },
    run: async (ctx, args) => {
      let spaces = args.space == null
        ? await ctx.dir.spaces(ctx.person)
        : [await ctx.dir.space(text(args.space, 'space'))]
      if (!spaces.length) spaces = [await ctx.dir.own(ctx.person)]
      let lines: string[] = []
      let out = []
      for (let space of spaces) {
        if (!space) throw new Error(`no space ${args.space}`)
        let who: Who = {
          person: ctx.person,
          role: await ctx.dir.role(space, ctx.person),
        }
        if (!who.role) throw new Error(`not a member of ${space.slug}`)
        let all = await ctx.dir.apps(space)
        // Two lists, because they are two different things to say: what the
        // person HAS, and what they threw away and can still have back
        // (erase.ts, T-34430).
        let apps = all.filter((a) => !a.trashed)
        let bin = all.filter((a) => a.trashed)
        // The space itself may be in the trash (erase.ts, T-34431), and then
        // NOTHING under it is answering however true the rest of the listing
        // still is — every app is kept exactly as it is, and that address is
        // where the person restores it.
        lines.push(
          `${space.slug} — https://${space.slug}.yaks.app/${
            space.trashed
              ? ` — IN THE TRASH, ${
                daysLeft(space.trashed)
              } days left: nothing here answers until space_restore(space: '${space.slug}')`
              : ''
          }`,
        )
        let listed = []
        for (let app of apps) {
          let errors = (await openIn(ctx.env, space, app, who, true)).length
          // What this app spent this month, as the hourly sweep last read it
          // (usage.ts). Nothing metered yet says nothing.
          let its = app.meter?.month == monthOf(new Date()) ? app.meter : null
          // The one the bare hostname opens, said where the person can see
          // it — the space line above is that address (T-32947).
          let front = app.home
          listed.push({
            slug: app.slug,
            title: app.title,
            url: url(space, app),
            // The other address it has (directory.ts `mailbox`): where its
            // letters leave from and where a reader writes back. Said here
            // because this is the listing a person is shown when they ask
            // what they have, and an address nobody is told is no address.
            mail: mailbox(space, app),
            version: app.version ?? 0,
            errors,
            usage: its,
            home: front,
          })
          lines.push(
            `- ${app.title} (${app.slug}) v${app.version ?? 0}${
              errors ? `, ${errors} open` : ''
            }${its ? `, ${its.requests} requests, ${size(its.bytes)}` : ''}: ${
              url(space, app)
            } · ${mailbox(space, app)}${front ? ' — the front page' : ''}`,
          )
        }
        if (!apps.length) lines.push('- no apps yet')
        // Where the space stands against what it is allowed (T-32758), in a
        // person's words rather than fractions — so the agent knows before it
        // makes the sixth app, not when the door says no. A space with
        // nothing in it has nothing to stand against, and says nothing.
        else lines.push(standing(space, apps.length))
        // And what was thrown away and can still be had back (erase.ts,
        // T-34430) — beside this space's own listing, since that is what it
        // is about.
        if (bin.length) {
          lines.push(
            'Trash — app_restore brings one back; erased for good when its ' +
              'days run out',
          )
          for (let app of bin) {
            lines.push(
              `- ${app.title} (${app.slug}), ${daysLeft(app.trashed!)} ${
                daysLeft(app.trashed!) == 1 ? 'day' : 'days'
              } left`,
            )
          }
        }
        out.push({
          slug: space.slug,
          title: space.title,
          url: `https://${space.slug}.yaks.app/`,
          apps: listed,
          trash: bin.map((a) => ({
            slug: a.slug,
            title: a.title,
            days: daysLeft(a.trashed!),
          })),
          tier: space.tier ?? 'free',
          usage: spent(space),
          // The letters and the builds are the allowances every plan carries,
          // so they are beside the three a free space alone answers to
          // (meter.ts). `usage.builds` is this month's; on the free plan the
          // ceiling is the space's whole life, which is `usage.built`.
          ceilings: {
            ...(ceilings(space.tier) ?? {}),
            emails: letters(space.tier),
            builds: builds(space.tier),
          },
        })
      }
      return {
        text: lines.join('\n'),
        data: { spaces: out },
        // Only one space in hand has an unseen channel to append to.
        space: spaces.length == 1 ? spaces[0]! : undefined,
      }
    },
  },
  {
    name: 'domain_attach',
    title: 'Attach a domain',
    destructive: false,
    idempotent: true,
    openWorld: true,
    description:
      "Serve one of the person's apps at a domain they already own — " +
      'herbusiness.com instead of jeff.yaks.app/recipes. It provisions the ' +
      'hostname here and answers with the DNS record they have to add where ' +
      'their domain is managed, as data: type, name, value. Add it for them ' +
      'if you can reach their registrar; otherwise walk them through their ' +
      "own panel — you know what GoDaddy's and Namecheap's look like. " +
      'Nothing serves until that record is in place, so tell them the ' +
      'record and then domain_status to watch it come up. Only the space ' +
      'owner may attach one.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP, hostname: HOSTNAME },
      required: ['app', 'hostname'],
    },
    run: async (ctx, args) => {
      let host = hostname(args.hostname)
      let { space, app, who } = await ownsApp(ctx, args)
      // A hostname on our own zone is not a domain anybody brought: every
      // space already answers at one, and route.ts decides which without
      // reading anything.
      if (!foreign(host)) {
        throw new Error(
          `${host} is on yaks.app, which is ours — a custom domain is one ` +
            `the person owns somewhere else. ${space.slug} already answers ` +
            `at https://${space.slug}.yaks.app/`,
        )
      }
      // One hostname is one place. Whose it is stays out of the refusal
      // unless it is this space's: another space's app names are not this
      // caller's to learn.
      let taken = await ctx.dir.serves(host)
      if (taken) {
        throw new Error(
          taken.space.eid == space.eid
            ? `${host} already serves ${space.slug}/${taken.app.slug} — ` +
              'domain_detach it first to move it'
            : `${host} is attached to another space on this platform. If it ` +
              "is the person's domain, whoever attached it has to " +
              'domain_detach it first',
        )
      }
      reachable(ctx.env)
      // The ROW first, then Cloudflare. The unique index on the name is what
      // decides who gets a hostname, so it decides before we spend a billable
      // custom hostname on it; an attach that Cloudflare then refuses takes
      // its own row back out.
      let eid = crypto.randomUUID()
      let at = new Date().toISOString()
      await ctx.dir.apply({
        entities: [{
          entity: { eid },
          hostname: { name: host, app: app.eid, stage: 'pending', at },
        }],
      }, vouched(who))
      let custom
      try {
        custom = await provision(ctx.env, host)
      } catch (e) {
        await ctx.dir.apply({
          entities: [{ entity: { eid }, tombstone: {} }],
        }, vouched(who)).catch(() => {})
        throw e
      }
      let how = steps(custom)
      let stage = stageOf(how)
      // What Cloudflare says is the PLATFORM's word, not the person's, so it
      // is stamped rather than written as them (directory.ts `stamp`) — which
      // is also what lets a viewer's domain_status refresh a stage below.
      if (stage != 'pending') {
        await stamp(ctx.env, {
          entities: [{ entity: { eid }, hostname: { stage, at } }],
        })
      }
      let recs = records(host)
      return {
        text: `${host} is attached to ${space.slug}/${app.slug}.\n\n` +
          `Add this record where ${host}'s DNS is managed:\n\n` +
          recs.map((r) => `  ${r.type}  ${r.name}  →  ${r.value}`).join('\n') +
          '\n\n' + (apex(host) ? APEX : '') +
          `${reading(how)}\n\nDNS usually takes minutes and can take a day; ` +
          'the certificate is issued within minutes of the record ' +
          `resolving. domain_status(hostname: '${host}') says where it is.`,
        data: {
          hostname: host,
          app: `${space.slug}/${app.slug}`,
          url: `https://${host}/`,
          stage,
          apex: apex(host),
          records: recs,
          steps: how,
        },
        space,
      }
    },
  },
  {
    name: 'domain_status',
    title: 'Domain progress',
    readOnly: true,
    openWorld: true,
    description:
      'How far a domain has come: whether the DNS record has arrived, ' +
      'whether Cloudflare has accepted the hostname, and whether the ' +
      'certificate is issued — each said specifically enough to tell the ' +
      'person what is still waiting on them. Read from Cloudflare, not ' +
      'from what we last wrote down. Leave hostname out for every domain in ' +
      'the space. Call it after domain_attach, and again a few minutes ' +
      'later; nothing needs doing between.',
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
        throw new Error(
          `${space.slug} has no domain ${want} — domain_attach it, or ` +
            'domain_status with no hostname for the ones it has',
        )
      }
      if (!rows.length) {
        return {
          text: `${space.slug} has no custom domain. It answers at ` +
            `https://${space.slug}.yaks.app/; domain_attach puts one of its ` +
            'apps on a domain the person owns.',
          space,
        }
      }
      reachable(ctx.env)
      let apps = await ctx.dir.apps(space)
      let out = []
      let lines = []
      for (let row of rows) {
        let app = apps.find((a) => a.eid == row.app)
        let where = `${space.slug}/${app?.slug ?? '?'}`
        let custom = await customOf(ctx.env, row.name)
        // A row whose hostname Cloudflare no longer has is the one state
        // nothing else can explain, and it is not something a person can
        // wait out: say the verb that fixes it.
        let how = custom ? steps(custom) : null
        let stage = how ? stageOf(how) : 'error' as const
        if (stage != row.stage) {
          await stamp(ctx.env, {
            entities: [{
              entity: { eid: row.eid },
              hostname: { stage, at: new Date().toISOString() },
            }],
          })
        }
        lines.push(
          `${row.name} → ${where}` +
            (stage == 'active' ? ` — live at https://${row.name}/` : '') +
            '\n' +
            (how
              ? reading(how)
              : '✗ Cloudflare no longer has this hostname — domain_detach ' +
                'it and domain_attach it again') +
            (stage == 'active' ? '' : '\n' +
              records(row.name).map((r) =>
                `  ${r.type}  ${r.name}  →  ${r.value}`
              ).join('\n')),
        )
        out.push({
          hostname: row.name,
          app: where,
          url: `https://${row.name}/`,
          stage,
          apex: apex(row.name),
          records: records(row.name),
          steps: how ?? [],
        })
      }
      return {
        text: lines.join('\n\n'),
        data: { domains: out },
        space,
      }
    },
  },
  {
    name: 'domain_detach',
    title: 'Detach a domain',
    destructive: true,
    idempotent: true,
    openWorld: true,
    description:
      'Stop serving an app at a domain. The hostname is given back to ' +
      'Cloudflare and the app is untouched — it still answers at its ' +
      '<space>.yaks.app address, and its data and files are not involved. ' +
      "The person's DNS record is theirs to remove wherever their domain is " +
      'managed; until they do it points at nothing. Only the space owner may.',
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
        throw new Error(
          `${space.slug} has no domain ${host} — domain_status says which ` +
            'domains it has',
        )
      }
      reachable(ctx.env)
      // Cloudflare FIRST, the row last. The row is the only record we keep
      // that the hostname exists, so a detach that dies between the two
      // leaves a row pointing at a hostname already given back — which the
      // next call finds and finishes. The other order leaves a billable
      // custom hostname nothing here remembers.
      let had = await release(ctx.env, host)
      await ctx.dir.apply({
        entities: [{ entity: { eid: row.eid }, tombstone: {} }],
      }, vouched(who))
      let app = (await ctx.dir.apps(space)).find((a) => a.eid == row.app)
      return {
        text:
          `${host} is detached${app ? ` from ${space.slug}/${app.slug}` : ''}` +
          (had ? '' : ' (Cloudflare had already given it back)') + '.' +
          (app ? ` It still answers at ${url(space, app)}.` : '') +
          `\n\nRemove the CNAME for ${host} wherever its DNS is managed; it ` +
          'points at nothing now.',
        space,
      }
    },
  },
  {
    name: 'app_publish',
    title: 'Offer the app to others',
    destructive: false,
    idempotent: true,
    openWorld: true,
    description:
      'Offer this app to every other space, by name. Someone else then ' +
      'app_installs it and gets their OWN copy — their own store, their own ' +
      'address, their own data from the first byte — pinned to the version ' +
      'you published; nothing is shared but the code. The name is the whole ' +
      "platform's, so it is the app's slug unless that is taken, and a taken " +
      'name is refused. Publishing again offers whatever is deployed now ' +
      'under the name it already has — a name is claimed once, and only an ' +
      'explicit name moves it, which leaves the old one resolving to ' +
      'nothing; nobody who installed it moves until they app_update. Only ' +
      'the space owner may publish, and only what the person asked to share. ' +
      'gallery: true also puts it forward to be SHOWN on ' +
      'https://yaks.app/gallery — a public page of what people have made. ' +
      "That is a separate thing from publishing and only ever the person's " +
      'own choice: ask them, never assume it. It is not listed on the spot — ' +
      'yaks.app reads the ask and answers, and the app is on offer either way.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        name: str(
          'the name others install it by, across the whole platform — the ' +
            "app's own slug the first time, and after that whatever it is " +
            'already offered as, unless you say otherwise',
        ),
        about: str('one line saying what it is, for someone browsing'),
        gallery: {
          type: 'boolean',
          description:
            'true to put it forward for https://yaks.app/gallery, the ' +
            'public page of apps made here. Only when the person has said ' +
            'they want it shown. It goes on the page once yaks.app agrees; ' +
            'app_set(app, gallery: false) takes it back at any time',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await ownsApp(ctx, args)
      // A name is claimed ONCE. Publishing again with none said keeps the
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
        throw new Error(
          `${name} is published by ${taken.space.slug}/${taken.app.slug} — ` +
            'a published name is one app on the whole platform, so offer ' +
            'this one under another (app_publish name: …)',
        )
      }
      // What is on offer is what is SERVING, and an app that never deployed
      // serves nothing an installer could copy.
      let version = app.version ?? 0
      if (!version) {
        throw new Error(
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
      // What the answer has to carry is whether the NAME moved, because that
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
      // offer forward, false takes it back. The row is read BACK first — the
      // letter names the offer as it now stands, and on a first publish the
      // app in hand has no offer on it at all.
      let shown: Standing | null = null
      if (show) {
        let now = (await ctx.dir.app(space, app.slug, true))!
        shown = await toGallery(ctx, space, now)
      } else if (show == false && onGallery(app) != 'no') {
        await unGallery(ctx.env, app)
        shown = 'no'
      }
      return {
        text: `published ${name} v${version} from ${space.slug}/${app.slug}` +
          (about ? ` — ${about}` : '') + said +
          (shown ? `\n${saying(shown)}` : ''),
        space,
      }
    },
  },
  {
    name: 'app_unpublish',
    title: 'Stop offering the app',
    destructive: true,
    idempotent: true,
    openWorld: true,
    description:
      'Stop offering the app. It stays exactly as it is and so does every ' +
      'copy anyone installed — their data is theirs — but nobody new can ' +
      'install it, and the name is free again. It leaves the gallery at the ' +
      'same moment, if it was on it. Only the space owner may.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await ownsApp(ctx, args)
      if (!app.published) {
        throw new Error(`${space.slug}/${app.slug} is not published`)
      }
      // A component off an entity, which is a null beside its name — the app
      // itself is untouched, and so is everyone who installed it.
      await ctx.dir.apply(
        { entities: [{ entity: { eid: app.eid }, published: null }] },
        vouched(who),
      )
      // And the gallery with it (gallery.ts): the page shows what a person can
      // install, so an app nobody can install is not on it. The word comes
      // OFF rather than being remembered — being shown is a thing we agreed
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
    title: 'Published apps',
    readOnly: true,
    // The gallery is the one list here that is nobody's own: an offer is made
    // to the whole platform, so a stranger browses it (anon.ts).
    security: EITHER,
    description:
      'What other people have published here, newest first: the name to ' +
      'install by, what it is, and which space it came from. Read it when ' +
      'the person asks for something somebody may already have made — ' +
      'installing one is app_install, and gives them their own copy with ' +
      'their own data. With words, only the offers whose name, title or ' +
      'description say them. It needs no account: a published app is offered ' +
      'to everybody, and its own pages are readable at the address printed ' +
      'here.',
    input: {
      type: 'object',
      properties: {
        words: str(
          'search the offers — a word or two of what it should be about. ' +
            'Leave it out for all of them',
        ),
      },
    },
    run: async (ctx, args) => {
      let offers = await ctx.dir.offers()
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
    title: 'Install a published app',
    destructive: false,
    description:
      'Take an app somebody published (app_published lists them) and give ' +
      'the person their OWN copy of it: their own address, their own data ' +
      'store, their own everything from the first byte. Nothing is shared ' +
      'but the code, so what they save is theirs alone and the publisher ' +
      'never sees it. The copy is PINNED to the version it took — the ' +
      "publisher's next version does not arrive behind them; app_update " +
      'moves it, keeping their data. Then give them the link.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        name: str('the published name, from app_published'),
        as: str(
          "the address to put it at in their space — the app's own slug, " +
            'the one app_published prints, unless you say otherwise',
        ),
      },
      required: ['name'],
    },
    run: async (ctx, args) => {
      let name = slug(args.name, 'name')
      let offer = await ctx.dir.offered(name)
      if (!offer?.app.published) {
        throw new Error(
          `nothing is published as ${name} — app_published lists what is on ` +
            'offer',
        )
      }
      let { space, who } = await inSpace(ctx, args, true)
      // An installed app costs what any other does, so it is counted like any
      // other (T-32758) — the same refusal app_new gives.
      let free = ceilings(space.tier)
      let apps = await ctx.dir.apps(space)
      if (free && apps.length >= free.apps) {
        throw new Error(atCeiling(space, 'apps'))
      }
      // The address the copy takes: the SOURCE app's own slug, not the
      // published name. An app is written at its own address — a page that
      // names `/chores/api/client.js`, an app that reaches a sibling by name
      // — so a copy landing at `chore-chart` is renamed out from under its
      // own files (C-32905 items 1 and 3). The kernel's `<base>` (apps.ts)
      // is what makes a page written relatively survive either way; this is
      // so the address reads like the app, and so an app written the old
      // absolute way still works. The published name is the fallback when
      // that address is spoken for here, and `as` is still the last word.
      let vacant = async (at: string) =>
        !(await ctx.dir.app(space, at)) && !(await ctx.dir.former(space, at))
      let s = args.as != null
        ? slug(args.as, 'as')
        : (await vacant(offer.app.slug))
        ? offer.app.slug
        : name
      if (await ctx.dir.app(space, s)) {
        throw new Error(
          `app ${s} exists in ${space.slug} — app_install(name, as: '…') ` +
            'puts the copy at another address',
        )
      }
      let moved = await ctx.dir.former(space, s)
      if (moved) {
        throw new Error(
          `${s} is where ${space.slug}/${moved.slug} used to be, and still ` +
            'points there — install it at another address (as:)',
        )
      }
      let version = offer.app.published.version
      // The app row, born the way app_new writes one — its own alias, so its
      // own store, pinned to the address it was born at — plus the pin that
      // says where the code came from and which version it took. Its access
      // is the published app's: an app written to be voted on has to stay
      // votable, and the person can app_set it after.
      let entities: EntityLiteral[] = [{
        entity: { eid: '$app' },
        doc: { title: offer.app.title },
        app: {
          slug: s,
          space: space.eid,
          version: 0,
          access: offer.app.access ?? 'public',
        },
        former: { slug: bornAt(space, s) },
        installed: { of: offer.app.eid, version },
      }]
      await ctx.dir.apply({ entities }, vouched(who))
      let app = (await ctx.dir.app(space, s))!
      let onto = { space, app }
      let { wrote } = await copied(ctx, offer, onto)
      // A release of the copy, in the installer's own space: the components
      // its vocab.json declares planted in ITS store, its tools listed under
      // ITS slug, its worker.js uploaded as ITS own script.
      let out = await released(
        ctx,
        space,
        app,
        who,
        storeOf(ctx.env.STORE, storeName(space, app)),
      )
      return {
        text:
          `installed ${name} v${version} as ${space.slug}/${s}: ${
            url(space, app)
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
    title: 'Update an installed app',
    // The copy's files are replaced by the publisher's current ones and the
    // version it was on is not offered again — app_rollback's shape, and its
    // hint. Their DATA is untouched, which is a different promise.
    destructive: true,
    description:
      'Move an installed app to whatever version its publisher offers now. ' +
      "The person's data stays — every row they saved is theirs and is not " +
      'touched — and only the code is replaced, so anything you wrote into ' +
      'the copy yourself is replaced too. A vocabulary that only grew is ' +
      'applied to their store; one that would retype a column their rows ' +
      'were written under is refused, and nothing moves. It answers what ' +
      'changed.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who, store } = await inApp(ctx, args, true)
      if (!app.installed) {
        throw new Error(
          `${space.slug}/${app.slug} was not installed from anywhere — it is ` +
            'their own app, and app_deploy releases what you write in it',
        )
      }
      let from = await ctx.dir.appAt(app.installed.of)
      if (!from?.app.published) {
        throw new Error(
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
      // The publisher's words against this store's own, BEFORE a byte of code
      // moves: a vocabulary that only grew lands through the store's own
      // additive graft, and one that conflicts is refused here with the
      // sentence a deploy gives (T-32728), leaving the copy as it was.
      let key = fileKey(from.space, from.app, 'vocab.json')
      let blobs = r2Blobs(ctx.env.BLOBS)
      if (await blobs.has(key)) {
        await fits(
          ctx,
          space,
          app,
          store,
          new TextDecoder().decode(await blobs.get(key)),
        )
      }
      let { wrote, gone } = await copied(ctx, from, { space, app })
      let out = await released(ctx, space, app, who, store)
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
    title: 'Invite someone',
    // The seat is additive and member_remove takes it back; the LETTER is
    // what leaves, and asking twice mails twice — so not idempotent either.
    destructive: false,
    openWorld: true,
    description:
      'Invite someone into the space by email address, so they can change ' +
      'what its apps hold: an editor writes, a viewer only reads, an owner ' +
      'may also invite. The invitation is MAILED to them — who invited them, ' +
      'the link, and that signing in at it with that address is all it takes ' +
      '— so name the app they are being invited to and the letter points at ' +
      "it instead of the space. Pass a note and the person's own message " +
      'goes at the top of that letter, as written and quoted as theirs: a ' +
      'line or two saying what this is ("the potluck list for Saturday"), ' +
      'which is the difference between an invitation someone opens and one ' +
      'they wonder about. Pass their name if you know it and their ' +
      'apps will show it beside what they write, so nobody sees an address; ' +
      'they can say for themselves at their first sign-in. There is nothing ' +
      'for them to install and no account to make first. ' +
      'Only the space owner may invite. For an app ' +
      'that everyone with the link should be able to act on without signing ' +
      "in at all, give it access 'open' instead (app_set).",
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        email: str('their email address'),
        app: str(
          'the app they are being invited to — the letter and the answer ' +
            'point at it; leave it out for the space itself',
        ),
        name: str(
          'what to call them — the name their apps show beside what they ' +
            'write. Leave it out and the first sign-in asks them',
        ),
        note: str(
          "the person's own message to them, carried at the top of the " +
            'letter as written and quoted as theirs — a line or two, not a ' +
            'newsletter. Leave it out and the letter is the invitation alone',
        ),
        role: {
          type: 'string',
          enum: [...ROLES],
          description:
            'editor (the default) reads and writes, viewer only reads, ' +
            'owner may invite others too',
        },
      },
      required: ['email'],
    },
    run: async (ctx, args) => {
      let { space, who } = await owns(ctx, args)
      let email = address(args.email)
      let want = args.role == null ? 'editor' : role(args.role)
      // Read before anything is written: a note too long is a refusal, and a
      // refused invitation mails nothing at all (T-32963).
      let note = args.note == null ? '' : noteOf(args.note)
      // What they were invited TO: the app, if one was named, else the
      // space. Name the app: the space's own address is its front page or a
      // list of what they may open (T-33040), and neither is the thing they
      // were invited to look at (C-32624 item 4).
      let app = args.app == null
        ? null
        : await ctx.dir.app(space, text(args.app, 'app'))
      if (args.app != null && !app) {
        throw new Error(`no app ${args.app} in ${space.slug}`)
      }
      let link = app ? url(space, app) : `https://${space.slug}.yaks.app/`
      // The platform's row for that address, minted if it has never seen
      // one: the invitation is what makes the person, and their sign-in
      // later finds this same row by the same address (signin.ts personOf).
      // What to call them, if the invitation said: it names them in the
      // letter and stands as their name until they choose one themselves
      // (signin.ts `personOf` never renames someone who has). Left out,
      // their first sign-in asks (T-32654).
      let name = args.name == null
        ? undefined
        : nameOf(text(args.name, 'name'), email)
      let person = await personOf(meta(ctx.env), email, name)
      let had = await ctx.dir.member(space, person)
      if (person == ctx.person && had) {
        throw new Error(`${email} is you, and you own ${space.slug}`)
      }
      await ctx.dir.apply({
        entities: [
          had ? { entity: { eid: had.eid }, member: { role: want } } : {
            entity: { eid: '$seat' },
            member: { space: space.eid, person, role: want },
          },
        ],
      }, vouched(who))
      // Being added is a deploy from where the added person stands: every
      // tool and view the space's apps declare just appeared for them, and
      // the deploy-time walk tells members — which they were not until now
      // (declared.ts, T-33004). A re-role moves nothing they can reach, and
      // neither does a space with no apps.
      if (!had && (await ctx.dir.apps(space)).length) {
        await reachChanged(ctx.env, person)
      }
      // The letter, from the platform's own sender — the one the sign-in
      // code rides (mail.ts). It goes AFTER the membership, which stands
      // whatever the mail does: a letter that cannot be sent is a link to
      // relay by hand, never a lost invitation.
      let what = app ? `${app.title} (${space.slug}/${app.slug})` : space.title
      // Who invited them, by name — an address is what the letter is sent
      // to, never what a person is called (T-32654).
      let by = await ctx.dir.nameAt(ctx.person)
      let sent = await mail(ctx.env)({
        to: email,
        subject: `${by ?? 'Someone'} invited you to ${what}`,
        body: (name ? `Hi ${name},\n\n` : '') +
          // Their words first, and marked as theirs, so a reader never takes
          // the platform to be saying them (T-32963).
          (note ? `${by ?? 'They'} wrote:\n\n${quoted(note)}\n\n` : '') +
          `${by ?? 'Someone'} invited you to ${what} on yaks.app:\n\n` +
          `${link}\n\n` +
          `Sign in there with this address (${email}) and it is yours to ` +
          `${want == 'viewer' ? 'read' : 'use'}. There is nothing to ` +
          'install and no account to make first.',
      }).then(() => true).catch(() => false)
      return {
        text:
          `${email} is ${want == 'editor' || want == 'owner' ? 'an' : 'a'}` +
          ` ${want} of ` +
          `${space.slug}${had ? ` (was ${had.role})` : ''} — ` +
          (sent
            ? `the invitation${
              note ? ' and your note are' : ' is'
            } on its way to them, with the link: ${link}`
            : `the invitation could not be mailed, so send them the link ` +
              `yourself: ${link}`) +
          `. They sign in there with that address, and it is theirs to ` +
          `${want == 'viewer' ? 'read' : 'use'}`,
        space,
      }
    },
  },
  {
    name: 'member_remove',
    title: 'Remove someone',
    destructive: true,
    idempotent: true,
    description:
      'Take someone back out of the space: they keep their sign-in and lose ' +
      'this space. Only the space owner may, and the last owner cannot be ' +
      'removed — a space with nobody to say who belongs is one nobody can ' +
      'ever open again.',
    input: {
      type: 'object',
      properties: { space: SPACE, email: str('their email address') },
      required: ['email'],
    },
    run: async (ctx, args) => {
      let { space, who } = await owns(ctx, args)
      let email = address(args.email)
      let person = await ctx.dir.personAt(email)
      let had = person && await ctx.dir.member(space, person)
      if (!had) throw new Error(`${email} is not a member of ${space.slug}`)
      if (had.role == 'owner' && (await ctx.dir.owners(space)) < 2) {
        throw new Error(`${email} is the only owner of ${space.slug}`)
      }
      await ctx.dir.apply({
        entities: [{ entity: { eid: had.eid }, tombstone: {} }],
      }, vouched(who))
      // The removed person's lists moved the other way: every tool and view
      // the space's apps declared is out of their reach, and the member walk
      // no longer finds them (declared.ts, T-33004).
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
    title: 'A token for the CLI',
    // It mints; the undo of a mint is the revoke that is also here, and a
    // revoke ends a token that was going to end anyway.
    destructive: false,
    description:
      'A short-lived token that signs the `yaks` CLI in as this person — the ' +
      'same identity and exactly the same access they have here, never more. ' +
      'Reach for it when someone wants to work from their own terminal, or ' +
      'wants a script to reach their apps: the answer is the one line they ' +
      'paste. It lasts an hour unless `hours` says otherwise (24 at most), ' +
      'and `space` narrows it to one space, which is what to do when it is ' +
      'going somewhere less careful than a laptop. Show them the answer as ' +
      'it is: the token is said ONCE and kept nowhere it can be read back. ' +
      '`revoke` takes one back before it expires, by the id the minting ' +
      'answer named.',
    input: {
      type: 'object',
      properties: {
        hours: {
          type: 'number',
          description: `how long it lasts, in hours — ${DEFAULT} by ` +
            `default, ${HOURS} at most`,
        },
        space: str(
          'narrow it to this one space: a grant naming one reaches that ' +
            "space's apps and nothing else of the person's",
        ),
        revoke: str(
          'take a grant back instead of minting one: its id, or the front of ' +
            'one. Nothing else here is read when this is given',
        ),
      },
    },
    run: async (ctx, args) => {
      // A grant cannot mint a grant. Otherwise a token that leaked would keep
      // minting itself a fresh one for as long as anybody held it, and a
      // short life that renews itself is not a short life. One comes from
      // where the person actually signed in.
      if (ctx.who?.via == 'grant') {
        throw new Error(
          'This call is signed in with a grant, and a grant cannot mint ' +
            'another. Ask for one where you signed in — the connector, or ' +
            'the browser.',
        )
      }
      let secret = ctx.env.SESSION_SECRET
      let book = ledger(ctx.env.OAUTH_KV)
      if (!secret || !book) {
        throw new Error('grants are not switched on here')
      }
      if (args.revoke != null) {
        let said = text(args.revoke, 'revoke')
        let gone = await revoke(book, ctx.person, said)
        return {
          text: gone.length
            ? `Revoked ${gone.join(', ')}. Whatever was holding ` +
              `${gone.length > 1 ? 'those tokens' : 'that token'} is signed ` +
              'out within the minute.'
            : `Nothing of yours is named ${said}. A grant is gone the moment ` +
              'it expires, so an old one needs no revoking.',
        }
      }
      // Naming a space they cannot reach is refused HERE, where the refusal
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
        text: `yaks login ${token}\n\n` +
          'Paste that line into a terminal where the `yaks` CLI is ' +
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
  // What the person said, kept as they said it (memory.ts, T-34473). Owner,
  // 2026-09-06: "any user instruction about *how* they like their apps built
  // (etc) could be saved. And we could incorporate our 'grapevine' problem
  // learnings by prompting the agent to save what the user said verbatim
  // along with only the required context to understand it." An AGENTS.md is
  // the rules for ONE app, written by an agent; these are the person's own
  // sentences, space-wide, and every agent who can reach the space is handed
  // the newest few at connect (standing.ts).
  {
    name: 'memory_save',
    title: 'Keep what they said',
    destructive: false,
    description:
      'Keep what the person said about how they want something built or ' +
      'handled — their words, as they said them. Reach for it the moment ' +
      'they state a preference, a standard, a taste, a way of working, a ' +
      'thing they never want done again: "use grams, never cups", "keep it ' +
      'soft, not technical", "always show me the link". Save the SENTENCE, ' +
      'verbatim — never your summary of it, never a tidied-up version, ' +
      'never what you concluded from it. A summary can only lose what they ' +
      'said, and nobody can get it back. Add context only where the words ' +
      'are unreadable without it — one line saying what was being talked ' +
      'about, and no more; the words themselves carry the rest. It is kept ' +
      'for the whole space, so everyone working there sees it, and every ' +
      'agent that connects afterwards is handed the newest few. Rules for ' +
      "ONE app go in that app's AGENTS.md instead (guide page instructions).",
    input: {
      type: 'object',
      properties: {
        said: str(
          'the words the person used, exactly as they used them — their ' +
            'sentence, not a paraphrase of it',
        ),
        context: str(
          'the one line needed to understand those words later — what was ' +
            'being talked about when they said it. Two lines at most, and ' +
            'leave it out where the words stand on their own',
        ),
        about: str(
          'the app they were talking about, by slug, if there was one',
        ),
        space: SPACE,
      },
      required: ['said'],
    },
    run: async (ctx, args) => {
      let { space, who } = await inSpace(ctx, args, true)
      let kept = await remember(ctx.env, ctx.dir, space, who, {
        said: text(args.said, 'said'),
        context: args.context == null ? '' : String(args.context),
        about: args.about == null ? '' : String(args.about),
      })
      return {
        space,
        text: `Kept, in their words, for everyone in ${space.slug}:\n\n` +
          `"${kept.said}"${kept.context ? `\n${kept.context}` : ''}\n\n` +
          'Every agent that connects here is handed it; memory_recall ' +
          'finds it by what it is about.',
      }
    },
  },
  {
    name: 'memory_recall',
    title: 'What they have said',
    readOnly: true,
    description:
      'What the person has said about how they want things done, in their ' +
      'own words, ranked by what your words are about. Ask BEFORE building ' +
      'or changing an app, and whenever a choice is theirs to have made — ' +
      'how a page should look, what a thing should be called, how they want ' +
      'to be told about something. The newest few ride on every ' +
      'connection already; this is how the rest are found. Answers each ' +
      'memory whole, with the line of context saved beside it.',
    input: {
      type: 'object',
      properties: {
        words: str(
          'what you are about to do or decide, in a few words — "how should ' +
            'the pages look", "measurements in a recipe". Leave it out for ' +
            'the newest',
        ),
        limit: { type: 'number', description: 'how many at most (default 8)' },
        space: SPACE,
      },
    },
    run: async (ctx, args) => {
      let { space } = await inSpace(ctx, args)
      let said = args.words == null ? '' : String(args.words)
      let held = await memories(ctx.env, space, {
        said,
        limit: args.limit == null ? undefined : Number(args.limit),
      })
      if (!held.length) {
        return {
          space,
          text: `Nothing has been kept in ${space.slug} yet. When they say ` +
            'how they want something built or handled, memory_save keeps ' +
            'their words.',
        }
      }
      return {
        space,
        text: held.map((m) =>
          `"${m.said}"${m.context ? `\n  ${m.context}` : ''}` +
          `${m.about ? `\n  about the ${m.about} app` : ''}` +
          `${
            m.by ? `\n  — ${m.by}${m.at ? `, ${m.at.slice(0, 10)}` : ''}` : ''
          }`
        ).join('\n\n'),
      }
    },
  },
  {
    name: 'feedback',
    title: 'Send feedback',
    destructive: false,
    openWorld: true,
    // The one door that takes something FROM a stranger (anon.ts). What it
    // writes is the platform's own inbox and nobody's graph, so it is no more
    // an anonymous write than a letter is: harder-limited, and unsigned.
    security: EITHER,
    description:
      'The door for ALL feedback about yaks.app itself — this connector, its ' +
      'tools, its guide, the way an app is built or served here. A bug, a ' +
      'rough edge, a step that took three tries, a confusing answer, a wish, ' +
      'a feature idea, a thing that went well: all of it is wanted, from ' +
      "what YOU ran into working here or in the PERSON's own words. Not the " +
      'app you are building for the person: a break inside their own app is ' +
      'theirs and yours to fix (app_errors lists those). Reach for this the ' +
      'moment it comes up — a tool that refused for no reason you could ' +
      'find, a door that does not exist, an answer that disagreed with what ' +
      'was documented, a step the person found baffling, something they ' +
      'wished this place did, a sentence they said about any of it. Where ' +
      'something is broken, go on and work around it: nobody sees the ' +
      'workaround, and this is what they see instead. Say what the PERSON ' +
      'said, in their own words, and what YOU tried and what happened — ' +
      'those two are the whole report. Who they are, their space, the app if ' +
      'you name one, and the versions ride along on their own; do not repeat ' +
      'them. It reaches a person by mail, and they can write back. It works ' +
      'signed out too — the report then says it came from someone signed ' +
      'out, and there is no address to answer, so put one in the words if a ' +
      'reply is wanted.',
    input: {
      type: 'object',
      properties: {
        text: str(
          'the feedback itself — what is wrong, clumsy, missing, wished for ' +
            'or good: the words the person used, and what you tried',
        ),
        app: str(
          'the app they were looking at when it came up, if there was one',
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
        ? await ownSpace(ctx, args.app).catch(() => null)
        // Signed out there is no space of theirs to work out, and asking the
        // directory whose it might be would be reading about somebody.
        : null
      let app = space && args.app != null
        ? await ctx.dir.app(space, text(args.app, 'app'))
        : null
      let held = await recently(ctx)
      let cap = ctx.person ? HOURLY : STRANGERS
      if (held >= cap) {
        throw new Error(
          `That is ${held} already this hour, and every one of them is kept ` +
            'and will be read — so this is a pause, not a no. Save the rest ' +
            `for later, or write to ${REPLY_TO} directly if it cannot wait.` +
            (ctx.person ? '' : ` Signing in at ${SIGN_IN} raises it.`),
        )
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
        ...vouched({ person: ctx.person, role: null }),
        ...await titling(ctx.dir, ctx.person),
      })
      let eid = minted(wrote).$said ?? ''
      // The letter, to two readers at once: the platform's own address, which
      // is the one a person reading it would reply to (mail.ts REPLY_TO), and
      // the fleet's task graph (mail.ts GRAPH), where the sweep turns it into
      // mail an operator is notified of instead of one a person must relay.
      // One send, so it reaches both or neither and the answer below stays
      // true either way. It leads with the WORDS: what was said is the report,
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
      let sent = await mail(ctx.env)({
        to: [REPLY_TO, GRAPH],
        subject: `feedback: ${opening}`,
        body: `${said.trim()}\n\n—\n` +
          `${from}\n` +
          (where ? `${where}\n` : '') +
          (app && space ? `${url(space, app)}\n` : '') +
          `yaks.app ${VERSION} · ${at}\n${eid}`,
      }).then(() => true).catch(() => false)
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
    title: 'The guide',
    description: 'The guide, read here instead of fetched off the web. With ' +
      'no page: the map — what an app is, how its pages read and write its ' +
      'store, and a passage on every feature there is. Read that first. With ' +
      'a page: the whole of one subject. The pages are ' + COVERING +
      '. A name that is none of them answers the map, which lists them all. ' +
      'The same words are served to a person at https://yaks.app/guide.md.',
    readOnly: true,
    // The bytes the web already hands anybody at that address, so there is
    // nobody to sign in as to read them (anon.ts).
    security: EITHER,
    input: {
      type: 'object',
      properties: {
        page: str(
          `the page to read — one of ${SLUGS}. Leave it out for the map, ` +
            'which is what to read first',
        ),
      },
    },
    output: {
      type: 'object',
      properties: {
        page: str('the page answered — a slug, or `guide` for the map'),
        markdown: str('the page itself'),
      },
      required: ['page', 'markdown'],
    },
    run: async (ctx, args) => {
      // A page asked for as `mail.md`, or `Mail`, is the mail page.
      let asked = typeof args.page == 'string'
        ? args.page.trim().toLowerCase().replace(/\.md$/, '')
        : ''
      let page = PAGES.find((p) => p.slug == asked)
      let got = await asset(ctx.env, page ? uriOf(page.slug) : WHOLE)
      if (!got.ok) {
        await got.body?.cancel()
        throw new Error(`the guide is not being served just now — ${WHOLE}`)
      }
      let markdown = await got.text()
      // A page nobody has is a typo, not a refusal: the map is what they
      // wanted anyway, and one line above it says what the names are.
      if (asked && !page) {
        markdown = `There is no guide page \`${asked}\`. The pages are ` +
          `${SLUGS}. Here is the map.\n\n${markdown}`
      }
      return { text: markdown, data: { page: page?.slug ?? 'guide', markdown } }
    },
  },
  // And the tools anybody may call, signed in or not (preauth.ts, T-33030):
  // each says one fixed text and reads nothing, so the same words serve a
  // stranger and a member. They are lifted here rather than listed only at
  // the door, which is what makes the pre-auth list a SUBSET of this one
  // instead of a second surface that could drift from it.
  ...PUBLIC.map((t): Tool => ({
    name: t.name,
    title: t.title,
    description: t.description,
    input: NO_ARGS,
    // It says one fixed paragraph and looks nothing up — the readable tool
    // there is, and the one a host should never stop to ask about.
    readOnly: true,
    // And they say so in the signed-in list too, since the same tool cannot
    // need signing in on one list and not the other. Both schemes, because
    // both work: a token is welcome and none is needed (preauth.ts EITHER).
    security: EITHER,
    // Signed in, `about` also says who is asking, how they got in and until
    // when (`whoami`, T-34385), and what this door is listing right now with
    // the version naming that list (T-34277) — so an agent whose cached list
    // is old has one call that settles what it has, without reconnecting.
    // Before signing in the same words are said with neither (preauth.ts): the
    // public list is one tool, and it is this one.
    run: async (ctx) => ({
      text: t.text + await whoami(ctx) + said(ctx) + rostered(ctx),
    }),
  })),
  // And the gallery (gallery.ts, T-34478), which is the same list to a
  // stranger and to somebody signed in — a listing is a public page, so there
  // is nothing to narrow per caller. `app_published` above is the wider
  // question, every offer anybody has made; this one is the shown few.
  {
    name: 'gallery_search',
    title: 'Search the gallery',
    readOnly: true,
    // Both schemes: a token is welcome and none is needed, which is also how
    // the anonymous door knows it may call this (anon.ts `openly`).
    security: EITHER,
    description: 'Find an app somebody has already made and shown at ' +
      'https://yaks.app/gallery — a recipe box, a sign-up sheet, a tracker. ' +
      'Give it the words the person used. Each answer carries the line that ' +
      'gives them their own copy of it, at their own address with their own ' +
      'data. Read it before building something from scratch, and signed out ' +
      'too: the gallery is public.',
    input: {
      type: 'object',
      properties: {
        words: str(
          'what to look for, in the words the person used — matched against ' +
            "each listing's name and the line its maker wrote about it",
        ),
        limit: {
          type: 'number',
          description: 'how many at most (10 by default, 25 at the top)',
        },
      },
    },
    run: async (ctx, args) => ({ text: await searched(ctx.dir, args) }),
  },
]

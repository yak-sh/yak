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
import { appDoc } from './vocab.ts'
import { purged } from './files.ts'
import {
  type Access,
  type App,
  appStore,
  bornAt,
  type Directory,
  mailbox,
  META,
  type Role,
  type Space,
  stamp,
  storeName,
  url,
} from './directory.ts'
import { moved, reachChanged, toolsOf } from './declared.ts'
import { meta, minted } from './meta.ts'
import {
  doomed,
  door,
  emptied,
  letter,
  naming,
  refused,
  ticket,
} from './erase.ts'
import {
  drop,
  dropSecret,
  NEEDS_TOKEN,
  SECRET_NAME,
  secrets,
  setSecret,
  upload,
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
import { mail, REPLY_TO } from './mail.ts'
import { NO_ARGS, PUBLIC } from './preauth.ts'
import { foreign, SLUG } from './route.ts'
import type { Reach } from './reach.ts'
import { titling, vouched, type Who } from './session.ts'
import { mode, reads, writes } from '@yaks/member'
import { canon, nameOf, personOf } from './signin.ts'
import { type Door, storeOf } from './door.ts'
import { archive, cards, healed, line, openIn, serve } from './unseen.ts'
import {
  atCeiling,
  ceilings,
  letters,
  monthOf,
  size,
  spent,
  standing,
} from './meter.ts'
import {
  manifest,
  own,
  record,
  restore,
  restored,
  snapshot,
  type Version,
  versions,
  whatChanged,
} from './versions.ts'

export type Ctx = { env: Env; dir: Directory; person: string }
type Args = Record<string, unknown>
// What a tool answers: the text, the space it worked in (so the door can
// append what is unseen there), and, for a tool with a view, the same answer
// as data — the host hands it to the iframe as the result's
// structuredContent (mcp.ts, MCP Apps spec §Notifications).
export type Out = { text: string; space?: Space; data?: unknown }

export type Tool = {
  name: string
  description: string
  // The `ui://` resource that draws this tool's answer, if it has one.
  view?: string
  // Who may call it (MCP Apps §Tools, `_meta.ui.visibility`): the model
  // always; add 'app' for a tool a view's own button calls back through the
  // host, which the host refuses for any tool that does not say so.
  visibility?: ('model' | 'app')[]
  input: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  run: (ctx: Ctx, args: Args) => Promise<Out>
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
  'https://yaks.app/guide/domains.md walks through each.\n\n'

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
let OPS = ['list', 'read', 'write', 'delete']

let text = (v: unknown, what: string) => {
  if (typeof v != 'string' || !v) throw new Error(`${what} is required`)
  return v
}

// A list argument, forgiving of a model that sends one id bare: a string
// and a list of one mean the same thing, and refusing the string would only
// teach the agent to guess again.
let list = (v: unknown, what: string) =>
  v == null ? [] : (Array.isArray(v) ? v : [v]).map((one) => text(one, what))

// The many-file form of a write: `files: [{path, content}]`, so an app is one
// call and not one call per file (C-32624 item 5). Each refusal says which
// entry was wrong, since the model sent them all at once.
let files = (v: unknown): { path: string; content: string }[] => {
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
      content: text(f.content, `files[${i}].content`),
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
      if (await ctx.dir.app(space, app)) holding.push(space)
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
  if (await blobs.has(key)) {
    let next = parseVocab(new TextDecoder().decode(await blobs.get(key)))
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
  let checked = parseTools(sent, { ...words, ...borrowed(borrows) })
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
  let workerKey = fileKey(space, app, 'worker.js')
  let ran = ''
  let worker = ''
  if (!(await blobs.has(workerKey))) {
    if (ctx.env.CF_WORKERS_TOKEN) await drop(ctx.env, storeName(space, app))
  } else if (!ctx.env.CF_WORKERS_TOKEN) ran = `\n${NEEDS_TOKEN}`
  else {
    worker = await upload(
      ctx.env,
      storeName(space, app),
      new TextDecoder().decode(await blobs.get(workerKey)),
    )
    ran = '\nworker: worker.js answers first; a 404 from it serves the files'
  }
  // What this release IS, kept so one word puts it back (T-32886): the files
  // as a manifest of path to the name of their bytes, those bytes pinned
  // beside them, and Cloudflare's name for the script this uploaded. The
  // app's version counter and the row that records the version move together.
  let prefix = fileKey(space, app, '')
  let pinned = await snapshot(blobs, prefix)
  let version = (app.version ?? 0) + 1
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
    let who: Who = {
      person: ctx.person,
      role: await ctx.dir.role(space, ctx.person),
    }
    if (!who.role) continue
    for (let app of await ctx.dir.apps(space)) {
      if (reads(mode(app.access), who.role)) out.push({ space, app, who })
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

// What this person has already said this hour, out of the meta store itself
// rather than a counter in some isolate — three per hour only means anything
// if it holds across the isolate a call lands in. A store that cannot answer
// counts nothing: a rate limit is never the reason feedback is lost.
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

export let TOOLS: Tool[] = [
  {
    name: 'space_new',
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
      if (await ctx.dir.space(s)) throw new Error(`space ${s} is taken`)
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
    description:
      'Close a space for good: every app in it, everything those apps have ' +
      'saved, their files, any domain aimed at them, and the address itself ' +
      '— which goes back into circulation, so someone else may take it ' +
      'later. There is no undo and nothing is kept. YOU CANNOT DO THIS: it ' +
      "mails the space's owner a link that does it, lasting an hour, and " +
      'answers with what that link would destroy. Read that back to them and ' +
      'tell them to check their email — it is theirs to confirm, not yours. ' +
      'Only the owner of the space may ask, and app_delete is the smaller ' +
      'thing when they mean one app.',
    input: {
      type: 'object',
      properties: { space: SPACE },
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
      if (!ctx.env.SESSION_SECRET) {
        throw new Error('the platform cannot sign a confirmation link here')
      }
      // Where the letter goes: the address this caller signs in with, which
      // is an owner's — never one the agent named, so nothing an agent says
      // can point this letter at somebody else.
      let to = await ctx.dir.emailAt(ctx.person)
      if (!to) throw new Error('we have no address to write to you at')
      let d = await doomed(ctx.dir, space)
      let said = naming(d).map((l) => `  - ${l}`).join('\n')
      let link = door(
        space.slug,
        await ticket(space, ctx.person, ctx.env.SESSION_SECRET),
      )
      // A letter that will not send is not a link to hand over (member_add
      // does that for an invitation, which is not an irreversible act): the
      // web door is said instead, and it still wants their cookie, their
      // ownership and the name typed back.
      try {
        await mail(ctx.env)({ to, ...letter(d, link) })
      } catch {
        throw new Error(
          `the confirmation letter could not be sent. They can still do it ` +
            `themselves, signed in, at ${door(space.slug)} — which asks ` +
            `them to type ${space.slug} back. It would destroy:\n${said}`,
        )
      }
      return {
        text: `nothing is deleted. ${space.slug} is still there, and an ` +
          'assistant cannot delete a space: a letter is on its way to the ' +
          'address they sign in with, carrying a link that does it. It ' +
          'lasts an hour, and opening it asks them once more. Tell them to ' +
          `check their email. What it would destroy:\n${said}`,
        space,
      }
    },
  },
  {
    name: 'app_new',
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
      let apps = await ctx.dir.apps(space)
      if (free && apps.length >= free.apps) {
        throw new Error(atCeiling(space, 'apps'))
      }
      if (await ctx.dir.app(space, s)) {
        throw new Error(`app ${s} exists in ${space.slug}`)
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
      // The alias is the name of the app's store, pinned at birth so a
      // later rename moves the address and not the data (directory.ts
      // storeName).
      let entities: EntityLiteral[] = [{
        entity: { eid: '$app' },
        doc: { title: text(args.title, 'title') },
        app: {
          slug: s,
          space: space.eid,
          version: 0,
          access: args.access == null ? 'public' : access(args.access),
        },
        alias: { slug: bornAt(space, s) },
      }]
      // Being first claims nothing (T-33040). Until somebody says which app
      // is the front page, the space's bare hostname lists the apps its
      // visitor may open; which app opens there is a choice, and arrival
      // order is not a choice anyone made. Said in the answer, because
      // nothing else tells a person the front page is theirs to set.
      let front = space.home ? await ctx.dir.home(space) : null
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
    description:
      "Write the app's files — index.html and any css, js or images beside " +
      'it — or list them, read one back, or delete one. Write a whole app in ' +
      'ONE call with files: [{path, content}, …] — a files batch IS the ' +
      'write, so leave op out; path and content write a ' +
      'single file. They serve live at ' +
      '<space>.yaks.app/<app>/<path>; index.html answers the directory. Keep ' +
      'what the app remembers in its own store, never localStorage: the page ' +
      'reads and writes it with `import { apply, query, search } from ' +
      "'./api/client.js'`, which is served beside the app. Write every " +
      "address relative: the kernel gives each page a `<base>` at the app's " +
      'own address, so nothing in an app names the app, and a copy someone ' +
      'installs at another address still works. The guide resource ' +
      '(https://yaks.app/guide.md) has the whole of it, in a page.',
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
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: str('the file path'),
              content: str('the file text'),
            },
            required: ['path', 'content'],
          },
          description: 'several files to write at once, instead of ' +
            'path and content — the whole app in one call',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let batch = files(args.files)
      // A batch says what it is: `files` is a write, whether or not `op`
      // came along. The refusal names the ops AND the batch, because a bare
      // "op is required" leaves an agent guessing at both (C-32624 item 5).
      let op = String(args.op ?? (batch.length ? 'write' : ''))
      if (!OPS.includes(op)) {
        throw new Error(
          `op: one of ${OPS.join(', ')} — write takes path and content, or ` +
            'files: [{path, content}] for several at once',
        )
      }
      let { space, app } = await inApp(
        ctx,
        args,
        op == 'write' || op == 'delete',
      )
      let blobs = r2Blobs(ctx.env.BLOBS)
      let prefix = fileKey(space, app, '')
      // A path as the app serves it: from the slash, no leading slashes.
      let at = (path: string) => fileKey(space, app, path).slice(prefix.length)
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
        if (op == 'read') {
          return { text: new TextDecoder().decode(await blobs.get(key)), space }
        }
        await blobs.delete(key)
        await purged(ctx.env, app)
        return { text: `deleted ${key.slice(prefix.length)}`, space }
      }
      let wrote = batch.length ? batch : [{
        path: text(args.path, 'path'),
        content: text(args.content, 'content'),
      }]
      for (let f of wrote) {
        await blobs.put(
          fileKey(space, app, f.path),
          new TextEncoder().encode(f.content),
        )
      }
      // One purge for the whole batch, after the last byte lands: the tag is
      // the app, not the file, so writing ten files empties the edge once
      // (cache.ts `tagsOf`).
      await purged(ctx.env, app)
      let paths = wrote.map((f) => at(f.path))
      return {
        text: paths.length == 1
          ? `wrote ${paths[0]} → ${url(space, app)}${paths[0]}`
          : `wrote ${paths.length} files → ${url(space, app)}: ${
            paths.join(', ')
          }`,
        space,
      }
    },
  },
  {
    name: 'app_deploy',
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
      'which keeps every row already written under it. A tools.json beside ' +
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
  {
    name: 'app_versions',
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
  {
    name: 'app_set',
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
      'the space with no front page. Only the space owner may move it.',
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
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args, true)
      let title = args.title == null ? null : text(args.title, 'title')
      let to = args.slug == null ? null : slug(args.slug, 'slug')
      let open = args.access == null ? null : access(args.access)
      let home = args.home == null ? null : flag(args.home, 'home')
      if (title == null && to == null && open == null && home == null) {
        throw new Error(
          'nothing to change: pass title, slug, access, home, or all',
        )
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
      // Alias slugs resolve like ids, and the BIRTH address is already the
      // primary one (app_new pins it), so only a later move adds a word.
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
          ...(keeping ? { alias: { slugs: keeping } } : {}),
        })
      }
      // The front page is a column on the space, so clearing it is the null
      // every other column clears with, and the write empties the
      // directory's cache — the hostname answers the new front page on the
      // next request, not a TTL later (directory.ts).
      if (home != null) {
        entities.push({
          entity: { eid: space.eid },
          space: { home: home ? app.eid : null },
        })
      }
      await ctx.dir.apply({ entities }, vouched(who))
      for (let key of keys) await blobs.delete(key)
      let now = (await ctx.dir.app(space, to ?? app.slug))!
      let after = {
        ...space,
        home: home == null ? space.home : home ? now.eid : null,
      }
      return {
        text: `app ${space.slug}/${now.slug}${
          title == null ? '' : ` "${title}"`
        }: ${url(after, now)}${
          moving ? ` (moved from /${app.slug}/, which now redirects here)` : ''
        }${open ? ` — ${told(open)}` : ''}${
          home == null
            ? ''
            : home
            ? ` — it is the front page now: https://${space.slug}.yaks.app/ ` +
              'opens it'
            : ` — no longer the front page: https://${space.slug}.yaks.app/ ` +
              "lists the space's apps again until another one is set home"
        }`,
        space,
      }
    },
  },
  {
    name: 'app_secret_set',
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
    description:
      'Throw an app away: its files, everything it saved, and its address, ' +
      'all gone for good — there is no undo and nothing is kept. Only when ' +
      'the person asks for the app to be deleted; app_files delete removes ' +
      'one file, and app_set moves an app rather than replacing it.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
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
      // What this app declared, asked before its store is emptied because
      // after that there is nothing to ask: an app that carried tools takes
      // them with it, and that moves the tool list of everyone in the space
      // — and its views the resource list (T-33004).
      let had = await toolsOf(ctx.env, space, app)
      let declared = Object.keys(had).length
      let viewed = Object.values(had).some((t) => t.view)
      // The storage, then the row that says the app exists — that order,
      // because the row is the app. A delete that dies halfway leaves an app
      // still named but emptied, which asking again finishes; the other order
      // would leave an unnamed app's files and rows behind for whatever is
      // made at this address next to inherit. The emptying itself is
      // erase.ts's, because deleting a SPACE empties every app in it the same
      // way (T-33166).
      let prefix = fileKey(space, app, '')
      let keys = await emptied(ctx.env, space, app, who)
      // Everything under the prefix goes; what the person is TOLD went is
      // their own files, not the bytes a version pinned or a page uploaded
      // (versions.ts `own`).
      let wrote = own(keys.map((k) => k.slice(prefix.length))).length
      await ctx.dir.apply({
        entities: [{ entity: { eid: app.eid }, tombstone: {} }],
      }, vouched(who))
      await moved(ctx, space, [
        ...(declared ? ['tools' as const] : []),
        ...(viewed ? ['resources' as const] : []),
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
    name: 'app_errors',
    description:
      "Everything still broken in the app: what a page threw in someone's " +
      'browser, what a request threw on the way, and what the platform ' +
      'reported. Each is an entity in the app store. New ones also ride the ' +
      'end of your next reply, once. Pass `fixed` with the ids you have ' +
      'fixed and they are archived, which is what stops them showing here ' +
      'and there. It draws itself where the person can see it, with the ' +
      'same button on each break.',
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
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let fixed = list(args.fixed, 'fixed')
      // Archiving is a write, so it wants a writer; reading the list does
      // not, and a viewer of the space still gets to see what is broken.
      let { space, app, who } = await inApp(ctx, args, !!fixed.length)
      let gone = fixed.length
        ? await archive(ctx.env, space, app, who, fixed)
        : 0
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
    name: 'app_list',
    description:
      'What the person already has here: every app in every space of theirs, ' +
      'with its address, the mailbox it sends and receives at, the version ' +
      'it is at, how many breaks are still open in it, which one is the ' +
      "space's front page, and what the month has cost against what the " +
      'space is allowed. Read it before making a second app, and when they ' +
      'ask what they have or where something lives.',
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
        let apps = await ctx.dir.apps(space)
        lines.push(`${space.slug} — https://${space.slug}.yaks.app/`)
        let listed = []
        for (let app of apps) {
          let errors = (await openIn(ctx.env, space, app, who, true)).length
          // What this app spent this month, as the hourly sweep last read it
          // (usage.ts). Nothing metered yet says nothing.
          let its = app.meter?.month == monthOf(new Date()) ? app.meter : null
          // The one the bare hostname opens, said where the person can see
          // it — the space line above is that address (T-32947).
          let front = app.eid == space.home
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
        out.push({
          slug: space.slug,
          title: space.title,
          url: `https://${space.slug}.yaks.app/`,
          apps: listed,
          tier: space.tier ?? 'free',
          usage: spent(space),
          // The letters are the one allowance every plan carries, so they are
          // beside the three a free space alone answers to (meter.ts).
          ceilings: {
            ...(ceilings(space.tier) ?? {}),
            emails: letters(space.tier),
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
      'the space owner may publish, and only what the person asked to share.',
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
      return {
        text: `published ${name} v${version} from ${space.slug}/${app.slug}` +
          (about ? ` — ${about}` : '') + said,
        space,
      }
    },
  },
  {
    name: 'app_unpublish',
    description:
      'Stop offering the app. It stays exactly as it is and so does every ' +
      'copy anyone installed — their data is theirs — but nobody new can ' +
      'install it, and the name is free again. Only the space owner may.',
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
      return {
        text: `${app.published.name} is no longer offered — whoever ` +
          'installed it keeps their copy, data and all',
        space,
      }
    },
  },
  {
    name: 'app_published',
    description:
      'What other people have published here, newest first: the name to ' +
      'install by, what it is, and which space it came from. Read it when ' +
      'the person asks for something somebody may already have made — ' +
      'installing one is app_install, and gives them their own copy with ' +
      'their own data.',
    input: { type: 'object', properties: {} },
    run: async (ctx) => {
      let offers = await ctx.dir.offers()
      return {
        text: offers.length
          ? offers.map(({ space, app }) =>
            `- ${app.published!.name} v${app.published!.version} — ` +
            `${app.title}${
              app.published!.about ? `: ${app.published!.about}` : ''
            } (from ${space.slug}/${app.slug}, installs as ${app.slug}, ` +
            `published ${app.published!.at.slice(0, 10)})`
          ).join('\n')
          : 'nothing is published yet',
      }
    },
  },
  {
    name: 'app_install',
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
        alias: { slug: bornAt(space, s) },
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
  {
    name: 'feedback',
    description:
      'Tell the people who run yaks.app that something is wrong with THE ' +
      'PLATFORM — this connector, its tools, its guide, the way an app is ' +
      'built or served here. Not the app you are building for the person: ' +
      'a break inside their own app is theirs and yours to fix (app_errors ' +
      'lists those). Reach for this the moment something here is broken, ' +
      'confusing or missing and you cannot fix it from where you are — a ' +
      'tool that refused for no reason you could find, a door that does not ' +
      'exist, an answer that disagreed with what was documented, a step the ' +
      'person found baffling. Then go on and work around it: nobody sees ' +
      'the workaround, and this is what they see instead. Say what the ' +
      'PERSON said, in their own words, and what YOU tried and what ' +
      'happened — those two are the whole report. Who they are, their ' +
      'space, the app if you name one, and the versions ride along on their ' +
      'own; do not repeat them. It reaches a person by mail, and they can ' +
      'write back.',
    input: {
      type: 'object',
      properties: {
        text: str(
          'what is wrong, confusing or missing: the words the person used, ' +
            'and what you tried',
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
      let space = args.space == null
        ? await ownSpace(ctx, args.app).catch(() => null)
        : await ctx.dir.space(text(args.space, 'space'))
      let app = space && args.app != null
        ? await ctx.dir.app(space, text(args.app, 'app'))
        : null
      let held = await recently(ctx)
      if (held >= HOURLY) {
        throw new Error(
          `That is ${held} already this hour, and every one of them is kept ` +
            'and will be read — so this is a pause, not a no. Save the rest ' +
            `for later, or write to ${REPLY_TO} directly if it cannot wait.`,
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
      // The letter, to the platform's own address — the one a person reading
      // it would reply to (mail.ts REPLY_TO). It leads with the WORDS: what
      // was said is the report, and everything else is a line of context
      // under a rule, so a person takes it in at a glance.
      let by = await ctx.dir.nameAt(ctx.person)
      let email = await ctx.dir.emailAt(ctx.person)
      let where = app && space
        ? `${space.slug}/${app.slug}${app.version ? ` v${app.version}` : ''}`
        : space?.slug ?? ''
      let sent = await mail(ctx.env)({
        to: REPLY_TO,
        subject: `feedback: ${opening}`,
        body: `${said.trim()}\n\n—\n` +
          `${by ?? 'someone'}${email ? ` <${email}>` : ''}\n` +
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
            }.`
          : 'The words are kept for the people who run yaks.app — the mail ' +
            'could not go out just now, so it waits with them rather than ' +
            'being lost. No need to say it again.',
      }
    },
  },
  // And the tools anybody may call, signed in or not (preauth.ts, T-33030):
  // each says one fixed text and reads nothing, so the same words serve a
  // stranger and a member. They are lifted here rather than listed only at
  // the door, which is what makes the pre-auth list a SUBSET of this one
  // instead of a second surface that could drift from it.
  ...PUBLIC.map((t): Tool => ({
    name: t.name,
    description: t.description,
    input: NO_ARGS,
    run: () => Promise.resolve({ text: t.text }),
  })),
]

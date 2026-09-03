// The connector's tools (D-32318 §Code, build, deploy), two tiers: the
// generic graph tier — graph_apply, graph_query, search — scoped to a
// (space, app) the caller names and belongs to, each an IO over the Store
// object's /apply and /query doors with the caller vouched server-side; and
// the platform sugar, the least that makes an app: space_new, app_new,
// app_files, app_deploy, app_set, app_delete, app_errors, app_list, the three
// that give an app's own worker a key it alone can read — app_secret_set,
// app_secret_list, app_secret_remove, whose values never enter this graph
// (T-32779) — and the two that say who an app is for: member_add and
// member_remove, the space
// owner's guest list, beside `app.access`, which is what an app lets a
// stranger with the link do (T-32504). A tool is one row here — name, what it
// does, its input as JSON Schema, and `run` — and the door (mcp.ts) reads the
// table for tools/list and tools/call.
//
// src/mcp.ts's registry is the shape mirrored, not imported. Its `IO` seam
// wants fifteen methods — the whole eager graph, work lanes, the provider
// table, verification, the frozen-page upload — and its tools are this
// fleet's own: sessions, claims, memory, spawn. None of that exists in a
// hosted space, and reaching it would drag the MCP SDK, zod, and node's
// SQLite into a Worker that has no node_modules. What does carry over is the
// three graph tools, and each is a dozen lines over the store's own /apply
// and /query. The rule for every write is session.ts's:
// an owner or editor of the space writes, a member reads, nobody else is
// answered at all. A write speaks the wire and nothing else — the entity
// bundle, or a flat Change batch. A deploy in v1 is a version bump, since an
// app's files serve live from its blob store.
import { r2Blobs } from '../../src/blobs_r2.ts'
import { TOOLS_EXAMPLE, viewsOf } from '../../src/store/tools.ts'
import {
  EXAMPLE,
  homed,
  type Homes,
  livesIn,
  parseVocab,
  type Vocab,
} from '../../src/store/vocab.ts'
import type { EntityLiteral } from '../../src/mutation.ts'
import { appAccess } from '../../src/types.ts'
import {
  type Access,
  type App,
  bornAt,
  type Directory,
  META,
  META_STORE,
  type Role,
  type Space,
  storeName,
} from './directory.ts'
import { toolsChanged, toolsOf } from './declared.ts'
import {
  drop,
  dropSecret,
  NEEDS_TOKEN,
  SECRET_NAME,
  secrets,
  setSecret,
  upload,
} from './dispatch.ts'
import type { Env } from './env.ts'
import { mail } from './mail.ts'
import { SLUG } from './route.ts'
import { type Reach, read, written } from './reach.ts'
import { mayWrite, reads, vouched, type Who } from './session.ts'
import { canon, nameOf, personOf } from './signin.ts'
import { storeOf } from './store.ts'
import { archive, cards, line, openIn, serve } from './unseen.ts'
import {
  atCeiling,
  ceilings,
  monthOf,
  sending,
  size,
  spent,
  standing,
} from './usage.ts'

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

// The space the caller means when they name none: their own. Signing in
// mints it, so this is one lookup and never a question; a person who signed
// in before that existed gets theirs on this very call (T-32482).
//
// With several, naming the APP is naming the space — the one of theirs that
// holds that slug. An app's own tool (declared.ts) knows its store and asks
// nothing, so the generic tier asking a member of two spaces to also name
// one read as the platform forgetting what it had just been told (C-32730
// item 6). Two spaces holding the same slug is the one genuine question, and
// only then are the names said.
let ownSpace = async (ctx: Ctx, app?: unknown) => {
  let spaces = await ctx.dir.spaces(ctx.person)
  if (spaces.length > 1 && typeof app == 'string' && app) {
    let holding: Space[] = []
    for (let space of spaces) {
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
  if (spaces.length > 1) {
    throw new Error(
      `space: name one of ${spaces.map((s) => s.slug).join(', ')}`,
    )
  }
  return spaces[0] ?? await ctx.dir.own(ctx.person)
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
  if (write && !mayWrite(who)) throw new Error(`not a writer of ${space.slug}`)
  return { space, who }
}

// The caller as the space's OWNER: who belongs is the owner's to say. An
// editor writes the data and the files; they do not hand out keys.
let owns = async (ctx: Ctx, args: Args) => {
  let { space, who } = await inSpace(ctx, args, true)
  if (who.role != 'owner') throw new Error(`not the owner of ${space.slug}`)
  return { space, who }
}

let inApp = async (ctx: Ctx, args: Args, write = false) => {
  let { space, who } = await inSpace(ctx, args, write)
  let slug = text(args.app, 'app')
  let app = await ctx.dir.app(space, slug)
  if (!app) throw new Error(`no app ${slug} in ${space.slug}`)
  return {
    space,
    app,
    who,
    store: storeOf(ctx.env.STORE, storeName(space, app)),
  }
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

// Every store this call reaches. An app named is that one store, as it always
// was; no app is the FEDERATED read (T-32698) — every app in every space the
// caller belongs to, or in the space they named, since an entity spans apps
// and only the whole set can compose it. What "reach" means is membership
// plus the app's own access: the door remembers nothing about which apps a
// session has opened (declared.ts), so a public app in a space the caller is
// not in is on the web and not here.
let inReach = async (ctx: Ctx, args: Args): Promise<Reach[]> => {
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
      if (reads(who, app.access)) out.push({ space, app, who })
    }
  }
  return out
}

// The space a federated answer belongs to, for the unseen block the door
// appends (mcp.ts): the one named, else the first store's — a fan-out has no
// single space, and asking the caller to name one to read across all of them
// would defeat the point.
let whichSpace = (reach: Reach[]) => reach[0]?.space

// A store door's answer as text, its refusal as the tool's error.
let answer = async (r: Response) => {
  let body = await r.text()
  if (!r.ok) throw new Error(body)
  return body
}

type Change = { eid: string; name: string; comp: unknown }

// What a write answers: one line a person's agent can repeat, naming every
// entity it touched by id and every alias it minted, so the next call can
// address them. The store's own answer is the wire's — a row per component
// written, stamps included — which reads as noise beside the sentences the
// app tools give (C-32531 item 5). `graph_query` reads the data back.
let wrote = (body: string, where: string) => {
  let out: { changes?: Change[]; aliases?: Record<string, string> }
  try {
    out = JSON.parse(body)
  } catch {
    return body
  }
  let changes = out.changes ?? []
  // A doc's body is stored as a content-addressed blob entity (db.ts
  // textBlob), so a batch of one recipe writes two rows. The person wrote
  // the recipe; the blob is the store's own business, the way it is in a
  // listing (query.ts selected()).
  let blobs = new Set(
    changes.filter((c) => c.name == 'blob').map((c) => c.eid),
  )
  changes = changes.filter((c) => !blobs.has(c.eid))
  let named = new Map(
    Object.entries(out.aliases ?? {}).map(([alias, eid]) => [eid, alias]),
  )
  let gone = new Set(
    changes.filter((c) => c.name == 'entity' && c.comp == null)
      .map((c) => c.eid),
  )
  let ids = [...new Set(changes.map((c) => c.eid))]
  let said = ids.slice(0, 10).map((id) =>
    `${named.has(id) ? `${named.get(id)}=` : ''}${id}${
      gone.has(id) ? ' (deleted)' : ''
    }`
  )
  if (ids.length > said.length) said.push(`…and ${ids.length - said.length}`)
  return `wrote ${ids.length} ${
    ids.length == 1 ? 'entity' : 'entities'
  } in ${where}: ${said.join(', ')}`
}

// A file's key: the app's slugs, then its path from the slash (apps.ts keyOf).
let fileKey = (space: Space, app: App, path: string) =>
  `${space.slug}/${app.slug}/${path.replace(/^\/+/, '')}`

let url = (space: Space, app: App) =>
  `https://${space.slug}.yaks.app/${app.slug}/`

// What an app's access means where it is felt: what happens when the person
// sends someone the link. Said on every tool that sets it, so the agent can
// repeat it and the person is never surprised by who can act on their app.
let told = (access: Access | null) =>
  access == 'open'
    ? 'anyone with the link can use it, signed in or not'
    : access == 'private'
    ? 'only its members can see it; member_add mails an invitation to one'
    : 'anyone with the link can see it; only its members can change it'

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
          { member: { space: '$space', person: ctx.person, role: 'owner' } },
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
      // The first app in a space answers its bare hostname.
      if (!space.home) {
        entities.push({ entity: { eid: space.eid }, space: { home: '$app' } })
      }
      await ctx.dir.apply({ entities }, vouched(who))
      let app = (await ctx.dir.app(space, s))!
      return {
        text: `app ${space.slug}/${s} (${app.eid}): ${url(space, app)}` +
          ` — ${told(app.access)}`,
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
      "'./api/client.js'`, which is served beside the app. The guide resource " +
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
        return {
          text: keys.map((k) => k.slice(prefix.length)).join('\n') ||
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
      'the files do, and whatever it answers 404 falls through to them.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who, store } = await inApp(ctx, args, true)
      // The app's own components, if it declares any. A manifest the store
      // refuses fails the deploy: the words and the tables must agree, and a
      // half-planted vocabulary is what `unknown component` is made of.
      let key = fileKey(space, app, 'vocab.json')
      let blobs = r2Blobs(ctx.env.BLOBS)
      let planted: string[] = []
      let dropped: string[] = []
      // What this manifest MOVED, which naming the components does not say: a
      // renamed column arrives beside the old one, and the old one keeps
      // every row already written under it (C-32652 item 4).
      let added: string[] = []
      let kept: string[] = []
      // And the words this app USES rather than homes (T-32728).
      let uses: Record<string, string> = {}
      if (await blobs.has(key)) {
        let next = parseVocab(new TextDecoder().decode(await blobs.get(key)))
        // One word, one home: a word another app in the space already
        // declares is that app's, so this deploy records a USE of it instead
        // of planting a second table, and any column it adds grows the
        // HOME's. The homes are read in app order, oldest first — the first
        // declarer is the home — and a word this app already declares stays
        // its own, because a store's vocabulary is additive forever.
        let said = await vocabs(ctx, space, app)
        let homes: Homes = {}
        for (let [slug, cols] of said) {
          if (slug == app.slug) continue
          for (let [name, one] of Object.entries(cols)) {
            if (name in homes || name in (said.get(app.slug) ?? {})) continue
            homes[name] = { at: slug, cols: one }
          }
        }
        let split = homed(next, homes)
        uses = split.uses
        // The home's table grows first: a use whose column the home does not
        // have yet is not a use anyone can write until it does.
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
      // And the app's own MCP tools (tools.json, T-32685), read the same way
      // and after the components, since a tool may write a word this very
      // deploy planted. The manifest is replaced whole — a declaration holds
      // no rows — so an app that deleted its tools.json deploys none.
      let toolsKey = fileKey(space, app, 'tools.json')
      let sent = await blobs.has(toolsKey)
        ? new TextDecoder().decode(await blobs.get(toolsKey))
        : '{}'
      // A `view` names a page in the app's OWN files (T-32687), so this is
      // the one thing about the manifest the store cannot check: it holds the
      // words, the blobs hold the pages. A view nobody deployed would be a
      // tool whose answer renders nothing, which is worse than a refusal.
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
      let tooled = JSON.parse(
        await answer(
          await store('/tools', { method: 'POST', body: sent }, vouched(who)),
        ),
      )
      let declared: string[] = tooled.tools ?? []
      // A tool list that moved is news to every agent connected who can
      // reach this app (declared.ts, T-32686).
      if (tooled.changed) await toolsChanged(ctx, space)
      // And the app's OWN code, if it wrote any (dispatch.ts, T-32778): the
      // worker.js among its files becomes its script in the dispatch
      // namespace, and an app that deleted its worker.js loses the script it
      // had, so what serves is what the files say. Without the platform's
      // Cloudflare token there is nothing to upload with — the files are
      // already live, so the deploy stands and says what is missing rather
      // than failing (T-32781).
      let workerKey = fileKey(space, app, 'worker.js')
      let ran = ''
      if (!(await blobs.has(workerKey))) {
        if (ctx.env.CF_WORKERS_TOKEN) await drop(ctx.env, storeName(space, app))
      } else if (!ctx.env.CF_WORKERS_TOKEN) ran = `\n${NEEDS_TOKEN}`
      else {
        await upload(
          ctx.env,
          storeName(space, app),
          new TextDecoder().decode(await blobs.get(workerKey)),
        )
        ran =
          '\nworker: worker.js answers first; a 404 from it serves the files'
      }
      let version = (app.version ?? 0) + 1
      await ctx.dir.apply(
        { entities: [{ entity: { eid: app.eid }, app: { version } }] },
        vouched(who),
      )
      return {
        text:
          `deployed ${space.slug}/${app.slug} v${version}: ${url(space, app)}` +
          ran +
          (declared.length
            ? `\ntools: ${declared.map((t) => `${app.slug}__${t}`).join(', ')}`
            : '') +
          (planted.length ? `\ncomponents: ${planted.join(', ')}` : '') +
          // A word another app in the space already homes: this app writes
          // it, and the answer says where its rows land (T-32728).
          livesIn(uses).map((said) => `\n${said}`).join('') +
          (added.length ? `\nadded: ${added.join(', ')}` : '') +
          // What to DO about a column the manifest stopped naming, which
          // the bare list never said: the board that read "5.2 mi in null
          // min" was a rename nobody was told to finish (C-32730 item 4).
          (kept.length
            ? `\nkept, not in vocab.json (the rows are there): ${
              kept.join(', ')
            } — name it in vocab.json again to keep writing it, or move its ` +
              'rows to the new word yourself, a row at a time with ' +
              'graph_query then graph_apply. Nothing is migrated behind you.'
            : '') +
          (dropped.length ? `\ndropped (no rows): ${dropped.join(', ')}` : ''),
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
      "the app, 'private' to shut it to everyone but its members.",
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        slug: str('the new path label, to move the app'),
        title: str('the new name'),
        access: ACCESS,
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args, true)
      let title = args.title == null ? null : text(args.title, 'title')
      let to = args.slug == null ? null : slug(args.slug, 'slug')
      let open = args.access == null ? null : access(args.access)
      if (title == null && to == null && open == null) {
        throw new Error('nothing to change: pass title, slug, access, or all')
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
      await ctx.dir.apply({
        entities: [{
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
        }],
      }, vouched(who))
      for (let key of keys) await blobs.delete(key)
      let now = (await ctx.dir.app(space, to ?? app.slug))!
      return {
        text: `app ${space.slug}/${now.slug}${
          title == null ? '' : ` "${title}"`
        }: ${url(space, now)}${
          moving ? ` (moved from /${app.slug}/, which now redirects here)` : ''
        }${open ? ` — ${told(open)}` : ''}`,
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
      let { space, app, who, store } = await inApp(ctx, args, true)
      // The directory lives in the meta space's own app: deleting it would
      // take every space, app and membership with it, so it is not an app to
      // throw away, whoever owns `yak`.
      if (space.slug == META.space && app.slug == META.app) {
        throw new Error(`${META.space}/${META.app} is the platform itself`)
      }
      // What this app declared, asked before its store is emptied because
      // after that there is nothing to ask: an app that carried tools takes
      // them with it, and that moves the tool list of everyone in the space.
      let declared = Object.keys(await toolsOf(ctx.env, space, app)).length
      // The bytes, then the data, then the row that says the app exists —
      // that order, because the row is the app. A delete that dies halfway
      // leaves an app still named but emptied, which asking again finishes;
      // the other order would leave an unnamed app's files and rows behind
      // for whatever is made at this address next to inherit.
      let blobs = r2Blobs(ctx.env.BLOBS)
      let keys = await blobs.list(fileKey(space, app, ''))
      for (let key of keys) await blobs.delete(key)
      // And the app's own code, which is not in the bucket: a script left in
      // the dispatch namespace would still answer at an address nothing
      // stands at (dispatch.ts).
      if (ctx.env.CF_WORKERS_TOKEN) await drop(ctx.env, storeName(space, app))
      // The store is named for where the app was born (directory.ts
      // storeName), so emptying it is what keeps a later app at the same
      // address from waking up in this one's graph.
      await answer(
        await store('/', { method: 'DELETE' }, {
          ...vouched(who),
          'x-yak-kernel': '1',
        }),
      )
      await ctx.dir.apply({
        entities: [{ entity: { eid: app.eid }, tombstone: {} }],
      }, vouched(who))
      if (declared) await toolsChanged(ctx, space)
      return {
        text: `deleted ${space.slug}/${app.slug}: ${keys.length} ${
          keys.length == 1 ? 'file' : 'files'
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
      'with its address, the version it is at, how many breaks are still ' +
      'open in it, and what the month has cost against what the space is ' +
      'allowed. Read it before making a second app, and when they ask ' +
      'what they have or where something lives.',
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
          listed.push({
            slug: app.slug,
            title: app.title,
            url: url(space, app),
            version: app.version ?? 0,
            errors,
            usage: its,
          })
          lines.push(
            `- ${app.title} (${app.slug}) v${app.version ?? 0}${
              errors ? `, ${errors} open` : ''
            }${its ? `, ${its.requests} requests, ${size(its.bytes)}` : ''}: ${
              url(space, app)
            }`,
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
          ceilings: ceilings(space.tier),
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
    name: 'member_add',
    description:
      'Invite someone into the space by email address, so they can change ' +
      'what its apps hold: an editor writes, a viewer only reads, an owner ' +
      'may also invite. The invitation is MAILED to them — who invited them, ' +
      'the link, and that signing in at it with that address is all it takes ' +
      '— so name the app they are being invited to and the letter points at ' +
      'it instead of the space. Pass their name if you know it and their ' +
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
      // What they were invited TO: the app, if one was named, else the
      // space. A link to the space root is a link to nothing when the app
      // does not answer the bare hostname (C-32624 item 4).
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
      let person = await personOf(
        storeOf(ctx.env.STORE, META_STORE),
        email,
        name,
      )
      let had = await ctx.dir.member(space, person)
      if (person == ctx.person && had) {
        throw new Error(`${email} is you, and you own ${space.slug}`)
      }
      await ctx.dir.apply({
        entities: [
          had
            ? { entity: { eid: had.eid }, member: { role: want } }
            : { member: { space: space.eid, person, role: want } },
        ],
      }, vouched(who))
      // The letter, from the platform's own sender — the one the sign-in
      // code rides (mail.ts). It goes AFTER the membership, which stands
      // whatever the mail does: a letter that cannot be sent is a link to
      // relay by hand, never a lost invitation.
      let what = app ? `${app.title} (${space.slug}/${app.slug})` : space.title
      // Who invited them, by name — an address is what the letter is sent
      // to, never what a person is called (T-32654).
      let by = await ctx.dir.nameAt(ctx.person)
      // The month's letters (T-32758): counted before this one goes, and past
      // the free tier's hundred there is no letter. The membership stands
      // either way — it costs nothing — so a ceiling here reads like a letter
      // that could not be sent, and the answer hands over the link to relay.
      let stopped = await sending(ctx.env, space).then(() => '').catch((e) =>
        e instanceof Error ? e.message : String(e)
      )
      let sent = !stopped && await mail(ctx.env)({
        to: email,
        subject: `${by ?? 'Someone'} invited you to ${what}`,
        body: (name ? `Hi ${name},\n\n` : '') +
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
            ? `the invitation is on its way to them, with the link: ${link}`
            : stopped
            ? `${stopped} So send them the link yourself: ${link}`
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
      return {
        text: `${email} is no longer a member of ${space.slug}`,
        space,
      }
    },
  },
  {
    name: 'graph_apply',
    description:
      "Put data in the app's store yourself — seeding it, or repairing what a " +
      'page wrote. An entity is {entity: {eid}, ...components}, where a ' +
      "'$alias' eid mints a new one (the answer maps it to its eid), as does a " +
      'uuid of your own that names nothing yet, a nested bundle stands in ' +
      'wherever an eid goes, and edges are the `dependency` component. The ' +
      "app's pages write this same shape through ./api/client.js. The " +
      'components every app shares are ' +
      '— doc (title, body), task (status, priority, project), project, ' +
      "comment, web, image, attachment, archived; components of the app's " +
      'own naming ride here too, once its vocab.json declares them and ' +
      'app_deploy has planted them. The answer is one line naming what was ' +
      'written, by id; graph_query reads the data back. One bundle may wear ' +
      "two apps' components at once — an entity spans apps — and each " +
      'component is written to the app that declares it; a shared one goes to ' +
      'the app you name, else the app where that entity already lives. The ' +
      'guide (https://yaks.app/guide.md) has all of it.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        entities: {
          type: 'array',
          items: { type: 'object' },
          description: 'the bundles',
        },
      },
      required: ['entities'],
    },
    run: async (ctx, args) => {
      if (!Array.isArray(args.entities)) {
        throw new Error('entities: a list of bundles')
      }
      // The app NAMED, if one is — the write still routes a declared
      // component to the app that owns the word, so the reach set is every
      // app either way (reach.ts `written`).
      let named = args.app == null ? undefined : await inApp(ctx, args, true)
      let reach = await inReach(ctx, { space: args.space })
      let out = await written(
        ctx.env,
        reach,
        named && (reach.find((r) => r.app.eid == named.app.eid) ?? named),
        args.entities as EntityLiteral[],
      )
      return {
        text: wrote(out.body, out.where),
        space: named?.space ?? whichSpace(reach),
      }
    },
  },
  {
    name: 'graph_query',
    description:
      "Read the app's store. To list EVERYTHING you saved, ask for the " +
      "component it wears: '.doc!' is every entity with a title (an empty " +
      "query selects nothing, so a bare 'limit=50' answers []). Then " +
      "'.doc.title~=cake' contains, '.task.status=open' equals, '.archived=' " +
      "is absent, '.loan?' asks for a component without filtering on it, " +
      "'id=<eid>' fetches one, 'limit=20' and 'after=<num>' page " +
      "(a windowed read answers the newest), '.count!' counts, and a bare " +
      "word is a full-text term. '&' joins filters, so '.doc!&.created!' is " +
      'your rows with the stamps saying who saved each and when — a listing ' +
      "leaves those out, and the platform's own error rows, unless named. " +
      'Answers entity JSON, {kind, entity: {eid, num}, ...components} — and ' +
      'only the components the filter NAMES, so ask for what you want; ' +
      "'*' answers every component, for looking rather than reading. The " +
      'same filter line the page passes to query() from ./api/client.js. ' +
      'Name an app to read that one; LEAVE app OUT to read every app at ' +
      'once — an entity spans apps, so one bundle can carry components from ' +
      "several: '.recipe!&.loan!' answers the entities wearing both, " +
      "'.recipe!&.loan?' answers every recipe with its loan where it has " +
      'one, and a bundle composed from two apps says which app holds which ' +
      'component in `_stores`.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP, filter: str('the filter line') },
      required: ['filter'],
    },
    run: async (ctx, args) => {
      let reach = await inReach(ctx, args)
      // The parameter is what everything else here calls it — a filter line
      // (C-32607 item 2, where `query` was the odd word out and the person's
      // agent reached for `filter` first). `query` stays a spelling of it:
      // an old caller is answered, never corrected.
      //
      // The refusal spells the argument and shows one, since the agent that
      // gets it guessed at the name: "filter is required" told someone who
      // had sent `filters: [...]` nothing about the word or its shape
      // (C-32730 item 3).
      let asked = args.filter ?? args.query
      if (typeof asked != 'string' || !asked) {
        throw new Error(
          "filter: one LINE, not a list — filter: '.doc!' is everything " +
            "saved here, and '&' joins several: '.doc!&.task.status=open'",
        )
      }
      return {
        text: JSON.stringify(await read(ctx.env, reach, asked)),
        space: whichSpace(reach),
      }
    },
  },
  {
    name: 'search',
    description:
      "Find words in the app's data — every title and body, ranked, with " +
      'filters riding along if you want them. The page has the same door as ' +
      'search() from ./api/client.js. Name an app to search that one; leave ' +
      'app out to search every app the person has, best hits first.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        text: str('words to find'),
        limit: { type: 'number', description: 'at most this many (20)' },
      },
      required: ['text'],
    },
    run: async (ctx, args) => {
      let reach = await inReach(ctx, args)
      let q = `${encodeURIComponent(text(args.text, 'text'))}&limit=${
        Number(args.limit) || 20
      }`
      return {
        text: JSON.stringify(await read(ctx.env, reach, q)),
        space: whichSpace(reach),
      }
    },
  },
]

// The connector's tools (D-32318 §Code, build, deploy), two tiers: the
// generic graph tier — graph_apply, graph_query, search — scoped to a
// (space, app) the caller names and belongs to, each an IO over the Store
// object's /apply and /query doors with the caller vouched server-side; and
// the platform sugar, the least that makes an app: space_new, app_new,
// app_files, app_deploy, app_set, app_delete, app_errors, app_list, and the
// two that say who an app is for — member_add and member_remove, the space
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
import { EXAMPLE } from '../../src/store/vocab.ts'
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
import type { Env } from './env.ts'
import { listing } from './listing.ts'
import { SLUG } from './route.ts'
import { mayWrite, vouched, type Who } from './session.ts'
import { canon, personOf } from './signin.ts'
import { storeOf } from './store.ts'
import { archive, cards, line, openIn, serve } from './unseen.ts'

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
  "the space slug — <space>.yaks.app. Leave it out and the person's own " +
    'space is used; only name one when they have more than one',
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

let text = (v: unknown, what: string) => {
  if (typeof v != 'string' || !v) throw new Error(`${what} is required`)
  return v
}

// A list argument, forgiving of a model that sends one id bare: a string
// and a list of one mean the same thing, and refusing the string would only
// teach the agent to guess again.
let list = (v: unknown, what: string) =>
  v == null ? [] : (Array.isArray(v) ? v : [v]).map((one) => text(one, what))

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

// The space the caller means when they name none: their own. Signing in
// mints it, so this is one lookup and never a question; a person who signed
// in before that existed gets theirs on this very call (T-32482). Several,
// and the tools say which names there are rather than guess between them.
let ownSpace = async (ctx: Ctx) => {
  let spaces = await ctx.dir.spaces(ctx.person)
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
    ? await ownSpace(ctx)
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
    ? 'only its members can see it; member_add invites someone by email'
    : 'anyone with the link can see it; only its members can change it'

// The views a tool's answer draws itself in — `ui://` resources the door
// serves from public/apps.html and public/errors.html (mcp.ts) and the host
// renders in an iframe.
export let APPS_VIEW = 'ui://yaks/apps'
export let ERRORS_VIEW = 'ui://yaks/errors'

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
      'it — or list them, read one back, or delete one. They serve live at ' +
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
        op: { type: 'string', enum: ['list', 'read', 'write', 'delete'] },
        path: str('the file path, e.g. index.html'),
        content: str('the file text, for write'),
      },
      required: ['app', 'op'],
    },
    run: async (ctx, args) => {
      let op = text(args.op, 'op')
      let { space, app } = await inApp(
        ctx,
        args,
        op == 'write' || op == 'delete',
      )
      let blobs = r2Blobs(ctx.env.BLOBS)
      let prefix = fileKey(space, app, '')
      if (op == 'list') {
        let keys = await blobs.list(prefix)
        return {
          text: keys.map((k) => k.slice(prefix.length)).join('\n') ||
            '(no files)',
          space,
        }
      }
      let key = fileKey(space, app, text(args.path, 'path'))
      if (op == 'read') {
        if (!(await blobs.has(key))) throw new Error(`no file ${args.path}`)
        return {
          text: new TextDecoder().decode(await blobs.get(key)),
          space,
        }
      }
      if (op == 'delete') {
        if (!(await blobs.has(key))) throw new Error(`no file ${args.path}`)
        await blobs.delete(key)
        return { text: `deleted ${key.slice(prefix.length)}`, space }
      }
      if (op != 'write') {
        throw new Error(`op: one of list, read, write, delete`)
      }
      await blobs.put(
        key,
        new TextEncoder().encode(text(args.content, 'content')),
      )
      return {
        text: `wrote ${key.slice(prefix.length)} → ${url(space, app)}${
          key.slice(prefix.length)
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
      `${EXAMPLE} — so the app gets typed components of its own.`,
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
      if (await blobs.has(key)) {
        let r = await store('/vocab', {
          method: 'POST',
          body: new TextDecoder().decode(await blobs.get(key)),
        }, vouched(who))
        planted = JSON.parse(await answer(r)).comps ?? []
      }
      let version = (app.version ?? 0) + 1
      await ctx.dir.apply(
        { entities: [{ entity: { eid: app.eid }, app: { version } }] },
        vouched(who),
      )
      return {
        text:
          `deployed ${space.slug}/${app.slug} v${version}: ${url(space, app)}` +
          (planted.length ? `\ncomponents: ${planted.join(', ')}` : ''),
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
      // The bytes, then the data, then the row that says the app exists —
      // that order, because the row is the app. A delete that dies halfway
      // leaves an app still named but emptied, which asking again finishes;
      // the other order would leave an unnamed app's files and rows behind
      // for whatever is made at this address next to inherit.
      let blobs = r2Blobs(ctx.env.BLOBS)
      let keys = await blobs.list(fileKey(space, app, ''))
      for (let key of keys) await blobs.delete(key)
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
      'with its address, the version it is at, and how many breaks are still ' +
      'open in it. Read it before making a second app, and when they ask ' +
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
          listed.push({
            slug: app.slug,
            title: app.title,
            url: url(space, app),
            version: app.version ?? 0,
            errors,
          })
          lines.push(
            `- ${app.title} (${app.slug}) v${app.version ?? 0}${
              errors ? `, ${errors} open` : ''
            }: ${url(space, app)}`,
          )
        }
        if (!apps.length) lines.push('- no apps yet')
        out.push({
          slug: space.slug,
          title: space.title,
          url: `https://${space.slug}.yaks.app/`,
          apps: listed,
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
      'may also invite. They sign in at https://yaks.app with that same ' +
      'address — there is nothing to install and no account to make first. ' +
      'Only the space owner may invite. For an app that everyone with the ' +
      'link should be able to act on without signing in at all, give it ' +
      "access 'open' instead (app_set).",
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        email: str('their email address'),
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
      // The platform's row for that address, minted if it has never seen
      // one: the invitation is what makes the person, and their sign-in
      // later finds this same row by the same address (signin.ts personOf).
      let person = await personOf(storeOf(ctx.env.STORE, META_STORE), email)
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
      return {
        text:
          `${email} is ${want == 'editor' || want == 'owner' ? 'an' : 'a'}` +
          ` ${want} of ` +
          `${space.slug}${had ? ` (was ${had.role})` : ''} — tell them to ` +
          `sign in at https://yaks.app with that address, and everything ` +
          `at https://${space.slug}.yaks.app/ is theirs to ` +
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
      'written, by id; graph_query reads the data back. The guide ' +
      '(https://yaks.app/guide.md) has all of it.',
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
      required: ['app', 'entities'],
    },
    run: async (ctx, args) => {
      let { space, who, store } = await inApp(ctx, args, true)
      if (!Array.isArray(args.entities)) {
        throw new Error('entities: a list of bundles')
      }
      let r = await store('/apply', {
        method: 'POST',
        body: JSON.stringify({ entities: args.entities }),
      }, vouched(who))
      return {
        text: wrote(await answer(r), `${space.slug}/${text(args.app, 'app')}`),
        space,
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
      "is absent, 'id=<eid>' fetches one, 'limit=20' and 'after=<num>' page " +
      "(a windowed read answers the newest), '.count!' counts, and a bare " +
      "word is a full-text term. '&' joins filters, so '.doc!&.created!' is " +
      'your rows with the stamps saying who saved each and when — a listing ' +
      "leaves those out, and the platform's own error rows, unless named. " +
      'Answers entity JSON, {kind, entity: {eid, ' +
      'num}, ...components} — the same filter line the page passes to ' +
      'query() from ./api/client.js.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP, filter: str('the filter line') },
      required: ['app', 'filter'],
    },
    run: async (ctx, args) => {
      let { space, who, store } = await inApp(ctx, args)
      // The parameter is what everything else here calls it — a filter line
      // (C-32607 item 2, where `query` was the odd word out and the person's
      // agent reached for `filter` first). `query` stays a spelling of it:
      // an old caller is answered, never corrected.
      let asked = text(args.filter ?? args.query, 'filter')
      let r = await store(`/query?${asked}`, {}, vouched(who))
      return { text: listing(await answer(r), asked), space }
    },
  },
  {
    name: 'search',
    description:
      "Find words in the app's data — every title and body, ranked, with " +
      'filters riding along if you want them. The page has the same door as ' +
      'search() from ./api/client.js.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        text: str('words to find'),
        limit: { type: 'number', description: 'at most this many (20)' },
      },
      required: ['app', 'text'],
    },
    run: async (ctx, args) => {
      let { space, who, store } = await inApp(ctx, args)
      let q = `${encodeURIComponent(text(args.text, 'text'))}&limit=${
        Number(args.limit) || 20
      }`
      let r = await store(`/query?${q}`, {}, vouched(who))
      return { text: listing(await answer(r), q), space }
    },
  },
]

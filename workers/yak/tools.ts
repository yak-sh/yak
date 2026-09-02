// The connector's tools (D-32318 §Code, build, deploy), two tiers: the
// generic graph tier — graph_apply, graph_query, search — scoped to a
// (space, app) the caller names and belongs to, each an IO over the Store
// object's /apply and /query doors with the caller vouched server-side; and
// the platform sugar, the least that makes an app: space_new, app_new,
// app_files, app_deploy, app_set, app_errors. A tool is one row here — name, what it
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
import {
  type App,
  bornAt,
  type Directory,
  type Space,
  storeName,
} from './directory.ts'
import type { Env } from './env.ts'
import { SLUG } from './route.ts'
import { mayWrite, vouched, type Who } from './session.ts'
import { storeOf } from './store.ts'
import { openIn, serve } from './unseen.ts'

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

let text = (v: unknown, what: string) => {
  if (typeof v != 'string' || !v) throw new Error(`${what} is required`)
  return v
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

// The platform's bookkeeping about a row — who wrote it and when, whether it
// has been served — as opposed to what the person saved. `archived` is not
// here: an app's agent reads and writes it (it is how an error is marked
// fixed), so it is the person's business too.
let STAMPS = ['created', 'updated', 'notified', 'opened', 'quarantined']

// A listing as a person's agent should read it (C-32498 item 10): the rows
// they saved, without the stamps the store keeps about saving them, and
// without a row that is nothing but stamps. Naming a stamp in the filter
// (`.created.by=…`) asks for it back — the tools never hide what was asked
// for. Anything that is not a row listing (an aggregate, say) passes through
// as it came.
let listing = (body: string, asked: string) => {
  let rows: unknown
  try {
    rows = JSON.parse(body)
  } catch {
    return body
  }
  if (!Array.isArray(rows)) return body
  let hidden = STAMPS.filter((s) => !asked.includes(`.${s}`))
  let out = []
  for (let row of rows as Record<string, unknown>[]) {
    let kept = Object.fromEntries(
      Object.entries(row).filter(([k]) => !hidden.includes(k)),
    )
    // `entity` and `kind` name a row; one with nothing else left was a stamp.
    if (Object.keys(kept).some((k) => k != 'entity' && k != 'kind')) {
      out.push(kept)
    }
  }
  return JSON.stringify(out)
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

// The view app_list draws its answer in — a `ui://` resource the door serves
// from public/apps.html (mcp.ts) and the host renders in an iframe.
export let APPS_VIEW = 'ui://yaks/apps'

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
      'release, and give them the link.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        slug: str('the path label'),
        title: str('its name'),
      },
      required: ['slug', 'title'],
    },
    run: async (ctx, args) => {
      let { space, who } = await inSpace(ctx, args, true)
      let s = slug(args.slug, 'slug')
      if (await ctx.dir.app(space, s)) {
        throw new Error(`app ${s} exists in ${space.slug}`)
      }
      // The alias is the name of the app's store, pinned at birth so a
      // later rename moves the address and not the data (directory.ts
      // storeName).
      let entities: EntityLiteral[] = [{
        entity: { eid: '$app' },
        doc: { title: text(args.title, 'title') },
        app: { slug: s, space: space.eid, version: 0 },
        alias: { slug: bornAt(space, s) },
      }]
      // The first app in a space answers its bare hostname.
      if (!space.home) {
        entities.push({ entity: { eid: space.eid }, space: { home: '$app' } })
      }
      await ctx.dir.apply({ entities }, vouched(who))
      let app = (await ctx.dir.app(space, s))!
      return {
        text: `app ${space.slug}/${s} (${app.eid}): ${url(space, app)}`,
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
      'Rename an app or change its title. The title is what it is called; ' +
      'the slug is its address, so changing it moves the app to ' +
      '<space>.yaks.app/<new>/ — its files and everything it has saved come ' +
      'with it, and the old address stops answering. Give the person the ' +
      'new link.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        slug: str('the new path label, to move the app'),
        title: str('the new name'),
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args, true)
      let title = args.title == null ? null : text(args.title, 'title')
      let to = args.slug == null ? null : slug(args.slug, 'slug')
      if (title == null && to == null) {
        throw new Error('nothing to change: pass title, slug, or both')
      }
      let moving = to != null && to != app.slug
      if (moving && await ctx.dir.app(space, to!)) {
        throw new Error(`app ${to} exists in ${space.slug}`)
      }
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
          ...(moving ? { app: { slug: to! } } : {}),
        }],
      }, vouched(who))
      for (let key of keys) await blobs.delete(key)
      let now = (await ctx.dir.app(space, to ?? app.slug))!
      return {
        text: `app ${space.slug}/${now.slug}${
          title == null ? '' : ` "${title}"`
        }: ${url(space, now)}${
          moving ? ` (moved from /${app.slug}/, which is gone)` : ''
        }`,
        space,
      }
    },
  },
  {
    name: 'app_errors',
    description:
      "Everything still broken in the app: what a page threw in someone's " +
      'browser, what a request threw on the way, and what the platform ' +
      'reported. Each is an entity in the app store; archive one when it is ' +
      'fixed. New ones also ride the end of your next reply, once.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args)
      let lines = await serve(ctx.env, space, who, app, true)
      return { text: lines.join('\n') || 'no open errors', space }
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
      'word is a full-text term. Answers entity JSON, {kind, entity: {eid, ' +
      'num}, ...components} — the same filter line the page passes to ' +
      'query() from ./api/client.js.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP, query: str('the filter line') },
      required: ['app', 'query'],
    },
    run: async (ctx, args) => {
      let { space, who, store } = await inApp(ctx, args)
      let asked = text(args.query, 'query')
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

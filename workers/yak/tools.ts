// The connector's tools (D-32318 §Code, build, deploy), two tiers: the
// generic graph tier — graph_apply, graph_query, search — scoped to a
// (space, app) the caller names and belongs to, each an IO over the Store
// object's /apply and /query doors with the caller vouched server-side; and
// the platform sugar, the least that makes an app: space_new, app_new,
// app_files, app_deploy, app_errors. A tool is one row here — name, what it
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
// bundle, or a flat Change batch where one eid must be the caller's own. A
// deploy in v1 is a version bump, since an app's files serve live from its
// blob store.
import { r2Blobs } from '../../src/blobs_r2.ts'
import type { EntityLiteral } from '../../src/mutation.ts'
import type { App, Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { SLUG } from './route.ts'
import { mayWrite, vouched, type Who } from './session.ts'
import { storeOf } from './store.ts'
import { serve } from './unseen.ts'

export type Ctx = { env: Env; dir: Directory; person: string }
type Args = Record<string, unknown>
// What a tool answers: the text, and the space it worked in, so the door can
// append what is unseen there.
export type Out = { text: string; space?: Space }

export type Tool = {
  name: string
  description: string
  input: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  run: (ctx: Ctx, args: Args) => Promise<Out>
}

let str = (description: string) => ({ type: 'string', description })

let SPACE = str('the space slug — <space>.yaks.app')
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

// The caller in the space: a member reads, an owner or editor writes.
let inSpace = async (ctx: Ctx, args: Args, write = false) => {
  let slug = text(args.space, 'space')
  let space = await ctx.dir.space(slug)
  if (!space) throw new Error(`no space ${slug}`)
  let who: Who = {
    person: ctx.person,
    role: await ctx.dir.role(space, ctx.person),
  }
  if (!who.role) throw new Error(`not a member of ${slug}`)
  if (write && !mayWrite(who)) throw new Error(`not a writer of ${slug}`)
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
    store: storeOf(ctx.env.STORE, space.slug, app.slug),
  }
}

// A store door's answer as text, its refusal as the tool's error.
let answer = async (r: Response) => {
  let body = await r.text()
  if (!r.ok) throw new Error(body)
  return body
}

// A file's key: the app's slugs, then its path from the slash (apps.ts keyOf).
let fileKey = (space: Space, app: App, path: string) =>
  `${space.slug}/${app.slug}/${path.replace(/^\/+/, '')}`

let url = (space: Space, app: App) =>
  `https://${space.slug}.yaks.app/${app.slug}/`

export let TOOLS: Tool[] = [
  {
    name: 'space_new',
    description:
      'Make a space — a tenant at <slug>.yaks.app — with you as its owner. ' +
      'Your first call; every other tool names a space you belong to.',
    input: {
      type: 'object',
      properties: { slug: str('the hostname label'), title: str('its name') },
      required: ['slug', 'title'],
    },
    run: async (ctx, args) => {
      let s = slug(args.slug, 'slug')
      if (await ctx.dir.space(s)) throw new Error(`space ${s} is taken`)
      // The space, its owner, and the owner's person row in one batch. A flat
      // Change batch, not a bundle: the person is keyed by the caller's
      // sign-in, and only a Change mints at an eid the caller names — a
      // bundle's `entity.eid` addresses an entity that already exists. Once
      // identity writes that row at sign-in (T-32327) this line changes
      // nothing and apply drops it.
      let eid = crypto.randomUUID()
      await ctx.dir.apply([
        { eid: ctx.person, name: 'person', comp: {} },
        { eid, name: 'doc', comp: { title: text(args.title, 'title') } },
        { eid, name: 'space', comp: { slug: s } },
        {
          eid: crypto.randomUUID(),
          name: 'member',
          comp: { space: eid, person: ctx.person, role: 'owner' },
        },
      ], vouched({ person: ctx.person, role: 'owner' }))
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
      'Make an app in a space: <space>.yaks.app/<slug>/. The first app becomes ' +
      "the space's home, answering the bare hostname. Write files with " +
      'app_files, then app_deploy.',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        slug: str('the path label'),
        title: str('its name'),
      },
      required: ['space', 'slug', 'title'],
    },
    run: async (ctx, args) => {
      let { space, who } = await inSpace(ctx, args, true)
      let s = slug(args.slug, 'slug')
      if (await ctx.dir.app(space, s)) {
        throw new Error(`app ${s} exists in ${space.slug}`)
      }
      let entities: EntityLiteral[] = [{
        entity: { eid: '$app' },
        doc: { title: text(args.title, 'title') },
        app: { slug: s, space: space.eid, version: 0 },
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
      "An app's files, served live at <space>.yaks.app/<app>/<path>: list them, " +
      'read one, or write one (index.html answers the directory).',
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        op: { type: 'string', enum: ['list', 'read', 'write'] },
        path: str('the file path, e.g. index.html'),
        content: str('the file text, for write'),
      },
      required: ['space', 'app', 'op'],
    },
    run: async (ctx, args) => {
      let op = text(args.op, 'op')
      let { space, app } = await inApp(ctx, args, op == 'write')
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
      if (op != 'write') throw new Error(`op: one of list, read, write`)
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
      'Deploy the app: bumps its version, the deploy an error names. Files serve live, ' +
      'so this is the mark that a set of writes is one release.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
      required: ['space', 'app'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args, true)
      let version = (app.version ?? 0) + 1
      await ctx.dir.apply(
        { entities: [{ entity: { eid: app.eid }, app: { version } }] },
        vouched(who),
      )
      return {
        text: `deployed ${space.slug}/${app.slug} v${version}: ${
          url(space, app)
        }`,
        space,
      }
    },
  },
  {
    name: 'app_errors',
    description:
      "The app's open errors: every exception (something the app threw) and error " +
      '(a failure the platform reported) not yet archived, seen or not. Each is an ' +
      'entity in the app store; archive one to close it.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
      required: ['space', 'app'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args)
      let lines = await serve(ctx.env, space, who, app, true)
      return { text: lines.join('\n') || 'no open errors', space }
    },
  },
  {
    name: 'graph_apply',
    description:
      "Write bundles into the app's graph: each entity is {entity: {eid}, ...components}, " +
      'a `$alias` eid mints, a nested bundle stands in wherever an eid goes, edges are ' +
      'the `dependency` component. Answers the effective changes and alias → eid.',
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
      required: ['space', 'app', 'entities'],
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
      return { text: await answer(r), space }
    },
  },
  {
    name: 'graph_query',
    description:
      "Read the app's graph with the filter grammar: '.doc.title~=cake', '.task.status=open', " +
      "'id=<eid>' fetches by address; 'limit=' and 'after=' page; '.count' counts. " +
      'Answers entity JSON, {kind, entity: {eid, num}, ...components}.',
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP, query: str('the filter line') },
      required: ['space', 'app', 'query'],
    },
    run: async (ctx, args) => {
      let { space, who, store } = await inApp(ctx, args)
      let r = await store(
        `/query?${text(args.query, 'query')}`,
        {},
        vouched(who),
      )
      return { text: await answer(r), space }
    },
  },
  {
    name: 'search',
    description:
      "Full-text search over the app's docs, ranked; filters may ride along.",
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        text: str('words to find'),
        limit: { type: 'number', description: 'at most this many (20)' },
      },
      required: ['space', 'app', 'text'],
    },
    run: async (ctx, args) => {
      let { space, who, store } = await inApp(ctx, args)
      let q = `${encodeURIComponent(text(args.text, 'text'))}&limit=${
        Number(args.limit) || 20
      }`
      let r = await store(`/query?${q}`, {}, vouched(who))
      return { text: await answer(r), space }
    },
  },
]

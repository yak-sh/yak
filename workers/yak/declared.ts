// The tools an APP declares (T-32685), at the platform's agent door: the
// `tools.json` a deploy handed its store (store/tools.ts), read back here and
// offered beside the platform's own tools as `<app>__<tool>` — the host-safe
// spelling, since an app slug carries no underscore. tools.ts owns the tools
// the platform has; this owns the ones a person's own app grew.
//
// A declared tool is a TEMPLATE, never code: its `apply` bundle or `query`
// line is filled from the call's arguments and sent through the app's
// ordinary doors with the caller vouched (apps.ts `acting`), so admission,
// `created.by` and every refusal are a page's. Code tools — an app's own
// Worker answering a call — wait on Workers for Platforms dispatch (T-32345).
//
// Which tools a caller sees is which apps they can reach: every app in every
// space they belong to. A `public` or `open` app in a space they are NOT in
// is reachable on the web and not here, because a bare `<app>__<tool>` has no
// space in it to resolve against — the door would have to remember which
// apps this session has opened, and it remembers nothing (mcp.ts).
import { type App, type Space, storeName } from './directory.ts'
import type { Env } from './env.ts'
import { acting, based } from './apps.ts'
import {
  filled,
  schemaOf,
  type ToolDef,
  type Tools,
} from '../../src/store/tools.ts'
import { type Ctx, type Out, VIEW_MIME } from './tools.ts'
import type { Who } from './session.ts'
import { r2Blobs } from '../../src/blobs_r2.ts'
import { storeOf } from './store.ts'
import { told } from './stream.ts'

// The two halves of a namespaced name. An app slug is `[a-z0-9-]` and a tool
// name `[a-z0-9_]`, so the first `__` is the seam and nothing else can be.
export let named = (app: App, tool: string) => `${app.slug}__${tool}`

let split = (name: string) => {
  let at = name.indexOf('__')
  return at < 1 ? null : { app: name.slice(0, at), tool: name.slice(at + 2) }
}

// What one app declares, as its store last accepted it.
export let toolsOf = async (
  env: Env,
  space: Space,
  app: App,
): Promise<Tools> => {
  let r = await storeOf(env.STORE, storeName(space, app))('/tools')
  if (!r.ok) {
    await r.body?.cancel()
    return {}
  }
  return await r.json() as Tools
}

// Every app this caller can reach, with the space it is in — the walk both
// the listing and a call resolve through. Two apps in two spaces can share a
// slug, and then one name means two things: the first is the one that
// answers, and a call for the other says which spaces have it.
export let reachable = async (ctx: Ctx) => {
  let out: { space: Space; app: App }[] = []
  for (let space of await ctx.dir.spaces(ctx.person)) {
    for (let app of await ctx.dir.apps(space)) out.push({ space, app })
  }
  return out
}

let whoIn = async (ctx: Ctx, space: Space): Promise<Who> => ({
  person: ctx.person,
  role: await ctx.dir.role(space, ctx.person),
})

// One call on an app's own tool, or null when no app of the caller's spells
// that name — the door then says what it says about any tool it has never
// heard of.
export let callDeclared = async (
  ctx: Ctx,
  name: string,
  args: Record<string, unknown>,
): Promise<Out | null> => {
  let parts = split(name)
  if (!parts) return null
  let mine = (await reachable(ctx)).filter((r) => r.app.slug == parts.app)
  if (!mine.length) return null
  if (mine.length > 1) {
    throw new Error(
      `${parts.app} is an app in ${
        mine.map((r) => r.space.slug).join(' and ')
      } — rename one, or use graph_apply with the space named`,
    )
  }
  let { space, app } = mine[0]
  let tool = (await toolsOf(ctx.env, space, app))[parts.tool]
  if (!tool) return null
  return { ...await ran(ctx, space, app, parts.tool, tool, args), space }
}

// The act itself: the template filled, sent the page's way, and answered as
// one sentence plus the rows or the ids as `structuredContent` — the same
// answer a view would draw (T-32687 gives an entry a `view`).
let ran = async (
  ctx: Ctx,
  space: Space,
  app: App,
  name: string,
  tool: ToolDef,
  args: Record<string, unknown>,
): Promise<Out> => {
  let act = filled(tool, args)
  let door = acting(ctx.env, space, app, await whoIn(ctx, space))
  if (act.query != null) {
    let rows = await door.query(act.query) as unknown[]
    let n = Array.isArray(rows) ? rows.length : 1
    return {
      text: `${named(app, name)}: ${
        Array.isArray(rows) ? `${n} ${n == 1 ? 'row' : 'rows'}` : 'answered'
      } in ${space.slug}/${app.slug}`,
      data: Array.isArray(rows) ? { rows } : rows as Record<string, unknown>,
    }
  }
  let out = await door.apply(
    Array.isArray(act.apply)
      ? { entities: act.apply }
      : { entities: [act.apply] },
  )
  // The entities this call wrote, by the alias the template minted them at
  // where it had one — an app's page reads a row back by eid, and so does the
  // agent's next call (tools.ts `wrote` says the same thing in words).
  let aliases = out.aliases ?? {}
  let ids = [...new Set((out.changes ?? []).map((c) => c.eid))]
  let said = Object.entries(aliases).map(([alias, eid]) => `${alias}=${eid}`)
  return {
    text: `${named(app, name)}: wrote ${ids.length} ${
      ids.length == 1 ? 'entity' : 'entities'
    } in ${space.slug}/${app.slug}${said.length ? `: ${said.join(', ')}` : ''}`,
    data: { entities: ids, aliases },
  }
}

// Every declared tool the caller can reach, as the agent door lists them
// beside the platform's own (T-32686). A tool's name is `<app>__<tool>`; its
// description carries the app's TITLE and address, since a slug is not what
// the person called it and a model choosing between tools reads the words.
// Two apps in two spaces can spell one slug: the first answers, and a call
// for the other says which spaces have it (`callDeclared`).
export let listDeclared = async (ctx: Ctx) => {
  let out: {
    name: string
    title: string
    description: string
    inputSchema: unknown
    _meta?: { ui: { resourceUri: string; visibility: string[] } }
  }[] = []
  let taken = new Set<string>()
  for (let { space, app } of await reachable(ctx)) {
    for (
      let [name, tool] of Object.entries(await toolsOf(ctx.env, space, app))
    ) {
      let spelled = named(app, name)
      if (taken.has(spelled)) continue
      taken.add(spelled)
      out.push({
        name: spelled,
        title: `${app.title || app.slug}: ${name}`,
        description: `${tool.description} — ${app.title || app.slug}, an app ` +
          `at ${space.slug}.yaks.app/${app.slug}/`,
        inputSchema: schemaOf(tool),
        // The page this tool's answer draws itself in, where it named one
        // (T-32687). `app` beside `model` in the visibility is what lets the
        // view call the tool BACK — the redraw a button or a date picker
        // needs — and it grants nothing the app's own page does not already
        // have, since the call goes through the app's ordinary doors as the
        // person looking at it.
        ...(tool.view
          ? {
            _meta: {
              ui: {
                resourceUri: viewUri(space, app, tool.view),
                visibility: ['model', 'app'],
              },
            },
          }
          : {}),
      })
    }
  }
  return out
}

// An app whose tools or views moved is news to everyone who can reach it:
// their list is stale, and MCP's word for that is `notifications/<list>/
// list_changed` on the session's stream (stream.ts) — tools when the tool
// set moved, resources when the view set did (T-33004), since a release can
// move either without the other. Reaching the app is being in the space, so
// the space's members are who to tell — each on their own object, which
// holds the line whether or not they are listening this second. One
// directory read per event however many lists moved, and nothing at all
// otherwise.
export let moved = async (
  ctx: Ctx,
  space: Space,
  lists: ('tools' | 'resources')[],
) => {
  if (!lists.length) return
  for (let person of await ctx.dir.members(space)) {
    for (let list of lists) {
      await told(ctx.env, person, `notifications/${list}/list_changed`)
    }
  }
}

export let toolsChanged = (ctx: Ctx, space: Space) =>
  moved(ctx, space, ['tools'])

export let resourcesChanged = (ctx: Ctx, space: Space) =>
  moved(ctx, space, ['resources'])

// One person's reach moved without any deploy (T-33004): added to or removed
// from a space, every tool and view its apps declare appeared or went for
// THEM, and `moved` above walks members — which they only just are, or no
// longer are. Told directly, both lists.
export let reachChanged = async (env: Env, person: string) => {
  await told(env, person, 'notifications/tools/list_changed')
  await told(env, person, 'notifications/resources/list_changed')
}

// A view a tool declares (T-32687): a page in the app's OWN files, offered
// at this door as a `ui://` resource the host renders the answer in. The
// address is the app's own, with the scheme swapped — `ui://<space>/<app>/
// <file>` — so a host that read the resource and a host that read the tool
// name the same thing without either knowing the other.
export let viewUri = (space: Space, app: App, file: string) =>
  `ui://${space.slug}/${app.slug}/${file}`

let AT = /^ui:\/\/([a-z0-9-]+)\/([a-z0-9-]+)\/(.+)$/

// Where the app's own pages live, which is what a relative URL inside a view
// has to mean.
let siteOf = (space: Space) => `https://${space.slug}.yaks.app`

// The host renders a view with no same-origin server behind it (spec
// §Content Requirements: an HTML document handed over as a resource), so a
// page lifted out of an app's files would lose every relative URL it has.
// The door prepends a `<base href>` naming the app's address and declares
// that address in the resource's `_meta.ui.csp` — `baseUriDomains` for the
// tag to be honored at all, `resourceDomains` for the stylesheet and the
// image it then reaches for. What a view still cannot do this way is
// `./api/…`: that is a cross-site request carrying no session cookie. Its
// data arrives in the tool's answer, and a redraw is a `tools/call` back
// through the host, which does carry who is asking.
export let cspFor = (space: Space) => ({
  ui: {
    csp: {
      baseUriDomains: [siteOf(space)],
      resourceDomains: [siteOf(space)],
    },
  },
})

// The pages the caller can reach, one entry each however many tools draw in
// them. What is listed is what a tool NAMED: an app's other files are the
// web's business, not this door's, and a private app's are nobody's.
export let listViews = async (ctx: Ctx) => {
  let out: {
    uri: string
    name: string
    title: string
    description: string
    mimeType: string
    _meta: ReturnType<typeof cspFor>
  }[] = []
  let seen = new Set<string>()
  for (let { space, app } of await reachable(ctx)) {
    for (let tool of Object.values(await toolsOf(ctx.env, space, app))) {
      if (!tool.view) continue
      let uri = viewUri(space, app, tool.view)
      if (seen.has(uri)) continue
      seen.add(uri)
      out.push({
        uri,
        name: `${space.slug}/${app.slug}/${tool.view}`,
        title: `${app.title || app.slug}: ${tool.view}`,
        description: `A page ${app.title || app.slug} draws its own tools' ` +
          `answers in, from ${space.slug}.yaks.app/${app.slug}/.`,
        mimeType: VIEW_MIME,
        _meta: cspFor(space),
      })
    }
  }
  return out
}

// One view's bytes, or null when no app the caller can reach declares that
// page. A file is readable here only because a TOOL named it: this is not a
// door onto an app's files, and a private app's pages stay private.
export let readView = async (ctx: Ctx, uri: string) => {
  let at = AT.exec(uri)
  if (!at) return null
  let [, slug, name, file] = at
  let mine = (await reachable(ctx)).find((r) =>
    r.space.slug == slug && r.app.slug == name
  )
  if (!mine) return null
  let { space, app } = mine
  let declared = Object.values(await toolsOf(ctx.env, space, app))
    .some((t) => t.view == file)
  if (!declared) return null
  let blobs = r2Blobs(ctx.env.BLOBS)
  let key = `${space.slug}/${app.slug}/${file}`
  if (!(await blobs.has(key))) return null
  let page = new TextDecoder().decode(await blobs.get(key))
  // The same tag the app door gives every page it serves (apps.ts
  // `based`), at the absolute address a page rendered off-origin needs.
  let home = `${siteOf(space)}/${app.slug}/`
  return { uri, text: based(home, page), _meta: cspFor(space) }
}

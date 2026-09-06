// The COMMANDS an app declares (T-32685, T-34541): the `tools.json` a deploy
// handed its store (store/tools.ts) and the two tools each word it holds is
// worth (kinds.ts), read back here and run through the platform's `command`
// tool. tools.ts owns the tools the platform has; this owns the verbs a
// person's own app grew.
//
// THEY ARE NOT MCP TOOLS, and that is the whole shape of this file (T-34541).
// A directory SNAPSHOTS `tools/list` when a connector is submitted and serves
// that snapshot forever — only `tools/call` reaches us
// (developers.openai.com/plugins/deploy/app-review). So a tool list that moves
// with whose token arrived, or with what somebody deployed this morning, is a
// list the published connector can never match: a name in the snapshot that is
// not here breaks the call, and a name here that is not in the snapshot is
// never offered. The roster is therefore FIXED — the same names for everybody,
// signed in or not — and an app's own verbs ride inside two of them:
// `commands` lists them with their arguments, `command` runs one. Jeff,
// 2026-09-06: "maybe we could have some custom 'commands' and those get added,
// and then we just have tools for calling commands?"
//
// A command is a TEMPLATE, never code: its `apply` bundle or `query` line is
// filled from the call's arguments and sent through the app's ordinary doors
// with the caller vouched (apps.ts `acting`), so admission, `created.by` and
// every refusal are a page's. Code commands — an app's own Worker answering a
// call — wait on Workers for Platforms dispatch (T-32345).
//
// Which commands a caller sees is which apps they can reach: every app in
// every space they belong to. A `public` or `open` app in a space they are NOT
// in is reachable on the web and not here, because a call names an app by slug
// and has no space to resolve it against — the door would have to remember
// which apps this session has opened, and it remembers nothing (mcp.ts).
import { type App, type Directory, type Space, storeName } from './directory.ts'
import type { Env } from './env.ts'
import { acting, based } from './apps.ts'
import {
  filled,
  schemaOf,
  type ToolDef,
  type Tools,
} from '../../src/store/tools.ts'
import { type Ctx, type Out, uiMeta, VIEW_MIME } from './tools.ts'
import type { Who } from './session.ts'
import { r2Blobs } from '../../src/blobs_r2.ts'
import { storeOf } from './door.ts'
import { told } from './stream.ts'

/** One app, as a command names it: `recipes`, or `jeff/recipes` where two
 * spaces spell one slug. */
export let at = (space: Space, app: App) => `${space.slug}/${app.slug}`

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
    // A space in the trash is out of reach whole (erase.ts, T-34431): every
    // app in it leaves every list at once, and none is asked about, which is
    // also why `about` and the door's own instructions stop naming them.
    if (space.trashed) continue
    // An app in the trash declares nothing (erase.ts, T-34430): its tools and
    // its views leave every list the day it is deleted, which is the same
    // move a delete has always made — and they come back on a restore.
    for (let app of await ctx.dir.apps(space)) {
      if (!app.trashed) out.push({ space, app })
    }
  }
  return out
}

let whoIn = async (ctx: Ctx, space: Space): Promise<Who> => ({
  person: ctx.person,
  role: await ctx.dir.role(space, ctx.person),
})

// The apps a call means: all the caller can reach, or the one it named —
// `recipes`, or `jeff/recipes` where two spaces spell one slug.
let picked = (all: { space: Space; app: App }[], said: string) => {
  if (!said) return all
  let [one, two] = said.split('/')
  return all.filter((r) =>
    two ? r.space.slug == one && r.app.slug == two : r.app.slug == one
  )
}

// What there is instead, when a caller asks for a command nobody has: every
// app they reach and what it offers, so the next call is the right one rather
// than another guess. An app declaring nothing is left out — naming it would
// only say where not to look.
let offered = async (ctx: Ctx, mine: { space: Space; app: App }[]) => {
  let said: string[] = []
  for (let { space, app } of mine) {
    let names = Object.keys(await toolsOf(ctx.env, space, app))
    if (names.length) said.push(`${at(space, app)}: ${names.join(', ')}`)
  }
  return said
}

/**
 * One command, run. `said` names the app where the caller named one, and is ''
 * where they left it out — which works whenever one app of theirs spells the
 * command, and says which apps do where several are.
 *
 * A name nobody has is a sentence saying what there IS, never an empty answer:
 * the command list is a person's own and a model cannot have memorized it.
 */
export let runCommand = async (
  ctx: Ctx,
  said: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Out> => {
  let all = await reachable(ctx)
  let mine = picked(all, said)
  if (said && !mine.length) {
    throw new Error(
      `no app ${said} — ${
        all.length
          ? `you can reach ${all.map((r) => at(r.space, r.app)).join(', ')}`
          : 'you have no apps yet; app_new makes one'
      }`,
    )
  }
  let found: { space: Space; app: App; tool: ToolDef }[] = []
  for (let { space, app } of mine) {
    let tool = (await toolsOf(ctx.env, space, app))[name]
    if (tool) found.push({ space, app, tool })
  }
  if (found.length > 1) {
    throw new Error(
      `${name} is a command of ${
        found.map((f) => at(f.space, f.app)).join(' and ')
      } — say which app`,
    )
  }
  if (!found.length) {
    let there = await offered(ctx, mine)
    throw new Error(
      `no command ${name}${said ? ` in ${said}` : ''} — ${
        there.length
          ? `the apps here offer ${there.join('; ')}`
          : 'no app you can reach declares one'
      }. commands lists them with their arguments.`,
    )
  }
  let { space, app, tool } = found[0]
  return { ...await ran(ctx, space, app, name, tool, args), space }
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
      text: `${name}: ${
        Array.isArray(rows) ? `${n} ${n == 1 ? 'row' : 'rows'}` : 'answered'
      } in ${at(space, app)}`,
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
  let aliases = out.aliases
  let ids = out.entities
  let said = Object.entries(aliases).map(([alias, eid]) => `${alias}=${eid}`)
  return {
    text: `${name}: wrote ${ids.length} ${
      ids.length == 1 ? 'entity' : 'entities'
    } in ${at(space, app)}${said.length ? `: ${said.join(', ')}` : ''}`,
    data: { entities: ids, aliases },
  }
}

/** One command, as `commands` says it. */
export type Command = {
  /** where it is, as `command` takes it: `jeff/recipes` */
  at: string
  name: string
  title: string
  description: string
  readOnly: boolean
  /** its arguments, as JSON Schema — what `command` fills `args` with */
  input: unknown
  /** the page a host draws its answer in, where it named one */
  view?: string
}

/**
 * Every command the caller can reach, or the ones of the one app they named.
 *
 * A command's own name is its whole name — `add_recipe`, not
 * `recipes__add_recipe` — because the app is said beside it rather than
 * spliced into it, and nothing here has to be a host-safe MCP tool name any
 * more. Its description carries the app's TITLE and address: a slug is not
 * what the person called it, and a model choosing between commands reads the
 * words. Two apps may spell one command; both are listed, and `command` asks
 * which when it is called with neither named.
 */
export let listCommands = async (
  ctx: Ctx,
  said = '',
): Promise<Command[]> => {
  let out: Command[] = []
  for (let { space, app } of picked(await reachable(ctx), said)) {
    for (
      let [name, tool] of Object.entries(await toolsOf(ctx.env, space, app))
    ) {
      out.push({
        at: at(space, app),
        name,
        title: `${app.title || app.slug}: ${name}`,
        description: `${tool.description} — ${app.title || app.slug}, an app ` +
          `at ${space.slug}.yaks.app/${app.slug}/`,
        // The declaration says which it is: a `query` tool is a filter line
        // and reads, an `apply` tool is a template and writes. Nothing an app
        // writes here leaves the platform, so none of them is open-world, and
        // a template carrying nulls can drop a component — so a writer takes
        // the destructive default rather than a promise this side cannot keep.
        readOnly: tool.query != null,
        input: schemaOf(tool),
        // The page this command's answer draws itself in, where it named one
        // (T-32687). It is still a `ui://` resource of this door's — the
        // resource list is a caller's own and no directory snapshots it — so
        // what moved is only who names it: `command` carries the uri on its
        // answer rather than a per-app tool carrying it in the tool list.
        ...(tool.view ? { view: viewUri(space, app, tool.view) } : {}),
      })
    }
  }
  return out
}

// An app whose VIEWS moved is news to everyone who can reach it: their
// resource list is stale, and MCP's word for that is `notifications/resources/
// list_changed` on the session's stream (stream.ts, T-33004). Reaching the app
// is being in the space, so the space's members are who to tell — each on
// their own object, which holds the line whether or not they are listening
// this second. One directory read per event, and nothing at all otherwise.
//
// The TOOL list is not news any more (T-34541), because it does not move: an
// app's own verbs are commands inside `command` and every caller sees the same
// roster, so a deploy that grew a verb, a person added to a space and an app
// into the trash all leave the tool list exactly where it was. A release still
// says all three lists moved (stream.ts `crossed`), which is the one thing
// that can move them.
//
// The two it needs and nothing else, so a door with no caller behind it can
// say the same news: the space page's restore form is a person's browser, not
// a tool call (apps.ts `saved`).
export let viewsMoved = async (
  ctx: { env: Env; dir: Directory },
  space: Space,
) => {
  for (let person of await ctx.dir.members(space)) {
    await told(ctx.env, person, 'notifications/resources/list_changed')
  }
}

// One person's reach moved without any deploy (T-33004): added to or removed
// from a space, every view its apps declare appeared or went for THEM, and
// `viewsMoved` above walks members — which they only just are, or no longer
// are. Told directly.
export let reachChanged = async (env: Env, person: string) => {
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
// through the host, which does carry who is asking — so nothing here is a
// `connectDomains`.
//
// The same site is the view's sandbox `domain` (tools.ts `uiMeta`): one
// origin per space, so one person's app view never shares a sandbox with
// another's.
export let metaFor = (space: Space) =>
  uiMeta(siteOf(space), {
    baseUriDomains: [siteOf(space)],
    resourceDomains: [siteOf(space)],
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
    _meta: ReturnType<typeof metaFor>
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
        _meta: metaFor(space),
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
  return { uri, text: based(home, page), _meta: metaFor(space) }
}

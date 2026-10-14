// Package declarations are the connector's fixed store-tool roster. The host
// lends the store and caller; the package owns the arguments and implementation.
import type { Bundle, NamedTool } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { loadTools } from '@yaks/graph/tools'
import type { Host } from '@yaks/host'
import type { Composition } from '@yaks/host/anatomy'
import { chosen, facetsOf, given, used } from '@yaks/host/config'
import { selected } from '@yaks/host/documents'
import { once } from '@yaks/fp'
import { toolsIn } from '@yaks/vocab/tools'
import { configs } from './config.ts'
import { load, vocabFacets } from './load.ts'
import { type Door, PLATFORM_STORE, storeOf } from './door.ts'
import { mailbox } from './directory.ts'
import { KERNEL } from './meta.ts'
import { titling, vouched, type Who } from './session.ts'
import {
  APP,
  type Args,
  type Ctx,
  inApp,
  inSpace,
  refuse,
  rejected,
  SPACE,
} from './tool.ts'

type Kind = keyof typeof configs
let contributions = (kind: Kind) =>
  (configs[kind].plugins ?? []).flatMap((p) => {
    let facets = facetsOf(p)
    if (facets && !facets.includes('tools')) return []
    let plugin = used(p)
    let docs = selected(vocabFacets[plugin]?.docs ?? [], chosen(p), plugin)
    return [{ plugin, docs, options: given(p) }]
  })

/** Bind the same selected declarations the connector lists, lazily loading code. */
export let storedTools = (
  host: Host,
  kind: Kind,
  space?: string,
  observed?: Pick<Composition, 'attempted' | 'loaded' | 'runs'>,
): NamedTool[] =>
  contributions(kind).flatMap(({ plugin, docs, options }) =>
    loadTools(docs, async () => {
      observed?.attempted(plugin, 'tools')
      let facet = await load(plugin, 'tools')
      observed?.loaded(plugin, 'tools', facet !== null)
      let runs =
        facet?.runs?.(host, { ...options, ...(space ? { space } : {}) }) ?? {}
      let definitions = toolsIn(docs)
      let joined = definitions.filter((d) =>
        typeof (runs[d.name!] ??
          runs[[d.noun, d.verb].filter(Boolean).join('_')]) == 'function'
      ).map((d) => d.name!)
      observed?.runs(
        plugin,
        joined,
        joined.length == definitions.length ? joined : [],
      )
      return runs
    })
  )

// Read from the declarations the first time the connector asks, not when the
// module loads: most requests an isolate starts for never list a tool.
let declarations = once(() =>
  (['directory', 'app'] as const).flatMap((kind) =>
    contributions(kind).flatMap(({ docs }) =>
      toolsIn(docs).filter((d) => !d.surfaces || d.surfaces.includes('mcp'))
        .map((definition) => ({ kind, definition, name: definition.name! }))
    )
  )
)
// These names keep their published argument and answer forms. The package's
// unambiguous name is prefixed at the transport boundary until that listing goes.
let published = new Set([
  'memory_save',
  'memory_recall',
  'connection_need',
  'connection_list',
  'builder_build',
  'builder_choose',
  'builder_supply',
  'mail_send',
])
export let packageName = (name: string) =>
  published.has(name) ? `store_${name}` : name
// A package's prose names its tools by the package's names; what the connector
// hands over (a description, the memory passage) names them as it lists them.
let mention = new RegExp(`(?<!\\w)(${[...published].join('|')})(?!\\w)`, 'g')
export let listedIn = (prose: string) => prose.replace(mention, packageName)
// References belong to the selected store. The connector's graph is a union
// of apps, so resolving a reference there would pick another app's names or
// reject a directory entity before the call reaches its own runner.
let routed = (schema: Record<string, unknown>): Record<string, unknown> => {
  let { ref: _, ...out } = schema
  if (typeof out.description == 'string') {
    out.description = listedIn(out.description)
  }
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties as Record<string, Record<string, unknown>>)
        .map(([name, prop]) => [name, routed(prop)]),
    )
  }
  if (out.items && !Array.isArray(out.items)) {
    out.items = routed(out.items as Record<string, unknown>)
  }
  return out
}
let listed = once(() =>
  declarations().map(({ kind, definition, name }) => ({
    ...definition,
    name: packageName(name),
    description: listedIn(definition.description),
    inputSchema: {
      ...routed(definition.inputSchema ?? {}),
      properties: {
        ...routed(definition.inputSchema ?? {}).properties as Record<
          string,
          unknown
        >,
        space: SPACE,
        // A directory connection's app is already a package argument. It accepts
        // its slug or id; every app-store tool adds this routing argument.
        ...(kind == 'app' ? { app: APP } : {}),
      },
      required: [
        ...definition.inputSchema?.required as string[] ?? [],
        ...(kind == 'app' ? ['app'] : []),
      ],
    },
  }))
)

/** One declared tool, through the store's own call ledger and runner. */
export let invokePackage = async (
  ctx: Ctx,
  name: string,
  args: Args,
  source?: string,
): Promise<Bundle[]> => {
  let declaration = declarations().find((d) => d.name == name)
  if (!declaration) throw refuse('missing', `no store tool ${name}`)
  let { kind, definition } = declaration
  let { space: _, app: appArg, ...input } = args
  let write = definition.readOnly !== true
  let appTarget = kind == 'app' ? await inApp(ctx, args, write) : undefined
  let target = appTarget ?? await inSpace(ctx, args, write)
  let { space, who } = target
  let store = appTarget?.store ?? storeOf(ctx.env.STORE, PLATFORM_STORE)
  if (kind == 'directory') {
    if (
      input.owner != null && input.owner != space.eid &&
      input.owner != ctx.person && input.owner != space.slug
    ) {
      throw refuse('access', 'owner must be the selected space or the caller')
    }
    if ('owner' in (definition.inputSchema?.properties as object ?? {})) {
      if (input.owner == null || input.owner == space.slug) {
        input.owner = space.eid
      }
    }
    if ('app' in (definition.inputSchema?.properties as object ?? {})) {
      let apps = await ctx.dir.apps(space)
      let app = apps.find((a) => a.eid == appArg || a.slug == appArg)
      if (!app || app.trashed) {
        throw refuse('missing', `no app ${appArg} in ${space.slug}`)
      }
      input.app = app.eid
    }
  } else if (name == 'mail_send' && input.from == null && appTarget) {
    input.from = mailbox(space, appTarget.app, ctx.env)
  }
  return callStored(store, name, input, who, {
    space: kind == 'directory' ? space.eid : undefined,
    source: source ?? ctx.call,
    title: await titling(ctx.dir, who.person),
  })
}

/** Invoke a selected store's declaration as the caller its door authorized. */
export let callStored = async (
  store: Door,
  name: string,
  args: Args,
  who: Who,
  options: { space?: string; source?: string; title?: Record<string, string> } =
    {},
): Promise<Bundle[]> => {
  let id = crypto.randomUUID()
  let res = await store('/call', {
    method: 'POST',
    body: JSON.stringify({
      name,
      args,
      space: options.space,
      id,
      source: options.source ?? id,
    }),
  }, { ...KERNEL, ...vouched(who), ...options.title })
  let answer = await res.json() as Bundle[] | { message?: string }
  if (!res.ok) {
    throw rejected(
      res.status,
      !Array.isArray(answer) ? answer.message ?? '' : '',
    )
  }
  return answer as Bundle[]
}

/** The declared package tools, bound to this connector caller. */
export let packageTools = (ctx: Ctx): NamedTool[] =>
  listed().map((definition, i) => ({
    ...definition,
    applied: true,
    run: (call) =>
      invokePackage(ctx, declarations()[i].name, argsOf(call), call.entity.eid),
  }))

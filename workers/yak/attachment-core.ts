import { argsOf, type Bundle, type Tool } from '@yaks/graph'
import { core, type CoreOpts, inputSchemaOf } from '@yaks/mcp'
import type { Vocab } from '@yaks/vocab'
import { operatorDoor } from './build-door.ts'
import { writeSpace } from './reach.ts'
import { apart, type Ctx, inSpace, SPACE, str } from './tool.ts'

// The connector's generic graph tools take the arguments nearly every other
// tool here takes, so a caller carrying `space` and `app` over from app_files
// is answered rather than refused, at every door that lists them: the
// connector, the Operator and a code_mode script alike.
//
// The reach is every app the caller can read, so `app` (with `space` where two
// spaces have an app by that name) narrows: a query to that app's rows (`.in=`)
// and a write's bundles to that app (`$app`). An id names one entity in every
// app, so graph_show reads it whole with or without them. `self` reads the
// caller's Operator attachment metadata in the space instead of the apps, and
// writes to their own conversations there what is theirs to write
// (operator-access.ts `mayWrite`).
let SELF = {
  type: 'boolean',
  description:
    'Read your Operator attachment and artifact metadata in this space instead of the apps.',
}

let SELF_APPLY = {
  type: 'boolean',
  description:
    'Write bundles to your Operator conversations in this space instead of ' +
    'the apps. Only three things there are yours to write: your own drafts, ' +
    'the archive mark on a line of one of your conversations, and the ' +
    'walkthrough mark on one of them. The Operator writes the rest: ask it ' +
    'with operator_chat; memory_save, task_new and goal_new write its ' +
    'memories, tasks and goals.',
}

let APP = {
  graph_query: str(
    'the app slug, as in <space>.yaks.app/<app>/, to read only its rows; ' +
      'omitted, every app you can reach',
  ),
  graph_show: str(
    'not needed: an id names one entity in every app you can reach',
  ),
  graph_apply: str(
    'the app slug, as in <space>.yaks.app/<app>/, that bundles write to, ' +
      'or <space>/<app> where two spaces have that app name. With app ' +
      'omitted, an explicit space limits the write to that space',
  ),
}

type Scoped = keyof typeof APP
let scoped = (name: string): name is Scoped => Object.hasOwn(APP, name)

// The one app `app` and `space` name, as the `.in=` clause and `$app` write it.
let named = (space: unknown, app: unknown) =>
  typeof app != 'string' || !app
    ? undefined
    : typeof space == 'string' && space
    ? `${space}/${app}`
    : app

/** A query's app as an `.in=` filter, before the connector picks its reach. */
export let inApp = (name: string, args: Record<string, unknown>) => {
  if (name != 'graph_query' || args.self) return args
  let { space, app, ...rest } = args
  let at = named(space, app)
  if (!at) return args
  let filters = Array.isArray(rest.filters) ? rest.filters : []
  return { ...rest, filters: [`.in=${at}`, ...filters] }
}

// Attach the destination to bundles after graph_apply has built the patch.
// The same target then applies to raw bundles, q, and field and link edits.
let targeted = async (
  ctx: Ctx,
  args: Record<string, unknown>,
  bundles: Bundle[],
): Promise<Bundle[]> => {
  let target = { app: args.app, space: args.space }
  apart(target)
  let space = target.space && !target.app
    ? (await inSpace(ctx, target, false, true)).space
    : undefined
  return bundles.map((b) => {
    if (target.app && '$app' in b) return b
    let app = { space: target.space, app: b.$app ?? target.app }
    apart(app)
    let at = named(app.space, app.app)
    if (at) return { ...b, $app: at }
    return { ...b, [writeSpace]: space?.eid }
  })
}

// What `self` asks the Operator's attachment door: graph_query's own line, or
// graph_show's ids as the one clause that door narrows by.
let selfQuery = (name: Scoped, args: Record<string, unknown>) => {
  if (name == 'graph_query') return args
  let ids = [args.ids, args.id].flat().filter((x) => typeof x == 'string')
  let { ids: _, id: __, ...rest } = args
  return { ...rest, q: `.entity.eid=${ids.join(',')}&*` }
}

let spaceSchema = (
  ctx: Ctx,
  tool: Tool,
  vocabIn: (space: string) => Promise<Vocab>,
): Tool => {
  let schema = inputSchemaOf(tool)
  return {
    ...tool,
    inputSchema: {
      ...schema,
      properties: {
        ...schema.properties as Record<string, unknown>,
        space: str(
          'Read the vocabulary of the apps you can reach in this space. ' +
            'Give its slug, id or former slug. Omit for all reachable apps.',
        ),
      },
    },
    run: async (call, graph) => {
      let { space: slug, ...args } = argsOf(call)
      if (slug == null) return tool.run(call, graph)
      let { space } = await inSpace(ctx, { space: slug })
      return tool.run(
        { ...call, call: { ...call.call as object, args } },
        { ...graph, vocab: await vocabIn(space.eid) },
      )
    },
  }
}

/** The connector's ordinary graph tools, with `space` and `app` on the reads
 * and the write, and with `self` a read of one's Operator attachments, or a
 * write to one's Operator conversations. That write lands in the Operator's
 * store, so its answer is the batch as applied there, in words the runner
 * keeps beside the call rather than bundles it would write to the apps. */
export let attachmentCore = (
  ctx: Ctx,
  opts: CoreOpts,
  vocabIn: (space: string) => Promise<Vocab>,
): Tool[] =>
  core(opts).map((tool) => {
    let name = tool.name ?? ''
    if (name == 'graph_schema') return spaceSchema(ctx, tool, vocabIn)
    if (!scoped(name)) return tool
    let schema = inputSchemaOf(tool)
    let writes = name == 'graph_apply'
    return {
      ...tool,
      inputSchema: {
        ...schema,
        properties: {
          ...schema.properties as Record<string, unknown>,
          space: SPACE,
          app: APP[name],
          self: writes ? SELF_APPLY : SELF,
        },
      },
      run: async (call, graph) => {
        let said = argsOf(call)
        if (!said.self) {
          let { space: _, app: __, self: ___, ...args } = inApp(name, said)
          let bundles = tool.run(
            { ...call, call: { ...call.call as object, args } },
            graph,
          )
          return writes ? targeted(ctx, said, await bundles) : bundles
        }
        let { space: _, app: __, self: ___, ...args } = said
        let { space, who } = await inSpace(ctx, said)
        if (writes) {
          let wrote = await operatorDoor(ctx.env, space, who, 'apply', {
            bundles: args.bundles,
          }) as Bundle[]
          return [{
            entity: { eid: '$applied' },
            content: { body: JSON.stringify(wrote) },
            output: { source: call.entity.eid, value: { bundles: wrote } },
          }]
        }
        return await operatorDoor(
          ctx.env,
          space,
          who,
          'attachments',
          { ...selfQuery(name, args), queryCall: call.entity.eid },
        ) as Bundle[]
      },
    }
  })

import { argsOf, type Bundle, type Tool } from '@yaks/graph'
import { core, type CoreOpts, inputSchemaOf } from '@yaks/mcp'
import { operatorDoor } from './build-door.ts'
import { type Ctx, inSpace, SPACE, str } from './tool.ts'

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
    'the app slug, as in <space>.yaks.app/<app>/, that bundles write to; ' +
      'omitted, each component goes to the app that declares it',
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

/** A call's arguments with the one app `app` and `space` name said where
 * the tool reads it: on a query's filters (`.in=`) or on each bundle
 * (`$app`). The connector's door narrows with it before it picks the reach a
 * call reads (mcp.ts `heard`), and each tool again for every other door. A
 * read with `self` is not of the apps, so its `space` stays for it. */
export let inApp = (name: string, args: Record<string, unknown>) => {
  let { space, app, ...rest } = args
  let at = named(space, app)
  if (!at || args.self) return args
  if (name == 'graph_query') {
    let filters = Array.isArray(rest.filters) ? rest.filters : []
    return { ...rest, filters: [`.in=${at}`, ...filters] }
  }
  if (name == 'graph_apply' && Array.isArray(rest.bundles)) {
    return {
      ...rest,
      bundles: rest.bundles.map((b) =>
        b && typeof b == 'object' && !('$app' in b) ? { ...b, $app: at } : b
      ),
    }
  }
  return rest
}

// What `self` asks the Operator's attachment door: graph_query's own line, or
// graph_show's ids as the one clause that door narrows by.
let selfQuery = (name: Scoped, args: Record<string, unknown>) => {
  if (name == 'graph_query') return args
  let ids = [args.ids, args.id].flat().filter((x) => typeof x == 'string')
  let { ids: _, id: __, ...rest } = args
  return { ...rest, q: `.entity.eid=${ids.join(',')}&*` }
}

/** The connector's ordinary graph tools, with `space` and `app` on the reads
 * and the write, and with `self` a read of one's Operator attachments, or a
 * write to one's Operator conversations. That write lands in the Operator's
 * store, so its answer is the batch as applied there, in words the runner
 * keeps beside the call rather than bundles it would write to the apps. */
export let attachmentCore = (ctx: Ctx, opts: CoreOpts): Tool[] =>
  core(opts).map((tool) => {
    let name = tool.name ?? ''
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
          return tool.run(
            { ...call, call: { ...call.call as object, args } },
            graph,
          )
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

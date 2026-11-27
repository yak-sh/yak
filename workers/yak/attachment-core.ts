import {
  argsOf,
  type Bundle,
  type Comp,
  type Graph,
  type Tool,
} from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { answers, asked } from '@yaks/graph/tools'
import { conjoin, whole } from '@yaks/query/core'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { core, type CoreOpts, inputSchemaOf } from '@yaks/mcp'
import { refusalOf } from '@yaks/tools'
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
// app, so graph_show reads it whole without them, and with them reads it in
// that app alone, as `in=<app>` among its ids does. `self` reads the
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
      'use yak/platform for the platform directory; omitted, every app you can reach',
  ),
  graph_show: str(
    'the app slug, as in <space>.yaks.app/<app>/, to read the ids in that ' +
      'app alone (yak/platform for the platform directory); omitted, every ' +
      'app you can reach',
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

/** A read's app as an `.in=` clause, before the connector picks its reach:
 * graph_query's filter, and an `in=` among graph_show's ids. */
export let inApp = (name: string, args: Record<string, unknown>) => {
  if (args.self || (name != 'graph_query' && name != 'graph_show')) return args
  let { space, app, ...rest } = args
  let at = named(space, app)
  if (!at) return args
  if (name == 'graph_show') {
    return { ...rest, ids: [[rest.ids ?? []].flat(), `in=${at}`].flat() }
  }
  let filters = Array.isArray(rest.filters) ? rest.filters : []
  return { ...rest, filters: [`.in=${at}`, ...filters] }
}

/**
 * graph_show's answer, where an id the reach does not hold is the platform
 * directory's: said as that store's, with the call that reads it, rather than
 * as an id that names nothing. Only a caller who may read the directory is
 * told; for anyone else the read refuses and the answer stands.
 */
let located = async (
  graph: Graph,
  args: Record<string, unknown>,
  shown: Bundle[] | Promise<Bundle[]>,
): Promise<Bundle[]> => {
  let { ids, clauses } = asked(args)
  let rows: Bundle[] = [], refused: Refused | undefined
  try {
    rows = await shown
  } catch (e) {
    if (!(e instanceof Refused) || clauses.length) throw e
    refused = e
  }
  let missing = ids.filter((id) => !rows.some(answers(id)))
  if (clauses.length || !missing.length) return rows
  let there: Bundle[]
  try {
    there = await graph.read(whole(conjoin(
      `.entity.eid=${missing.join(',')}`,
      `.in=${PLATFORM_STORE}`,
    )))
  } catch (e) {
    if (refusalOf(e)) return stood(refused, rows)
    throw e
  }
  let held = missing.filter((id) => there.some(answers(id)))
  if (!held.length) return stood(refused, rows)
  let one = held.length == 1
  let note = `${held.join(', ')} ${one ? 'is' : 'are'} in ` +
    `${PLATFORM_STORE}, not the apps graph_show read: it reads ` +
    `${one ? 'it' : 'them'} with app ${PLATFORM_STORE}, or ` +
    `in=${PLATFORM_STORE} among the ids`
  if (refused) throw new Refused(`${note}; ${refused.message}`)
  return rows.map((b) =>
    b.entity.eid == '$said'
      ? { ...b, content: { body: `${note}; ${(b.content as Comp).body}` } }
      : b
  )
}

// The answer as it stood: the refusal, or the rows.
let stood = (refused: Refused | undefined, rows: Bundle[]) => {
  if (refused) throw refused
  return rows
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
  let { ids } = asked(args)
  let { ids: _, id: __, ...rest } = args
  return { ...rest, q: `.entity.eid=${ids.join(',')}&*` }
}

let spaceSchema = (
  ctx: Ctx,
  tool: Tool,
  vocabIn: (space: string) => Promise<Vocab>,
  vocabAt: (app: string) => Promise<Vocab>,
): Tool => {
  let schema = inputSchemaOf(tool)
  return {
    ...tool,
    inputSchema: {
      ...schema,
      properties: {
        ...schema.properties as Record<string, unknown>,
        app: str(
          'Read one app’s vocabulary. Use space/app, or yak/platform for the platform directory.',
        ),
        space: str(
          'Read the vocabulary of the apps you can reach in this space. ' +
            'Give its slug, id or former slug. Omit for all reachable apps.',
        ),
      },
    },
    run: async (call, graph) => {
      let { space: slug, app, ...args } = argsOf(call)
      let at = named(slug, app)
      if (!at && slug == null) return tool.run(call, graph)
      let vocab = at
        ? await vocabAt(at)
        : await vocabIn((await inSpace(ctx, { space: slug })).space.eid)
      return tool.run(
        { ...call, call: { ...call.call as object, args } },
        { ...graph, vocab },
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
  vocabAt: (app: string) => Promise<Vocab>,
): Tool[] =>
  core(opts).map((tool) => {
    let name = tool.name ?? ''
    if (name == 'graph_schema') return spaceSchema(ctx, tool, vocabIn, vocabAt)
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
          if (name == 'graph_show') return located(graph, args, bundles)
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

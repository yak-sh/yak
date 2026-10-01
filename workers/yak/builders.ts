// Builders in an app's store. @yaks/builders opens a session and turns its
// answer into output rows; the store's existing session runner asks the model
// through the account's metered Workers AI binding (models.ts).
//
// `builder_build` is `builder build` for an app's builders: the connector
// checks the caller may write the app, and the store's `/build` door
// reconciles the builder as them, so what it asks a model spends the space's
// budget like the builder's other calls. It is how a staged builder is tried
// on a few rows before its mark comes off.
import { watches } from '@yaks/builders/effects'
import { modelTool } from '@yaks/builders/model'
import { type Ask, build } from '@yaks/builders/tools'
import type { Graph } from '@yaks/graph'
import { CallError, toolRow } from '@yaks/tools'
import { KERNEL } from './meta.ts'
import type { Plugin } from './plugin.ts'
import {
  APP,
  inApp,
  rejected,
  type Row,
  SPACE,
  str,
  text,
  worded,
} from './tool.ts'

export let builderModelTool = modelTool()

/** A store's `/build`, which only the kernel calls: the builder reconciled
 * now as `by`, answering the builds it planned. A refusal of the ask is the
 * caller's to read. */
export let building = async (
  graph: Graph,
  body: Ask & { by?: string },
): Promise<Response> => {
  let { by, ...ask } = body
  try {
    let builds = await build(graph, graph.vocab, ask, by ? { by } : null)
    return Response.json({ builds })
  } catch (e) {
    if (!(e instanceof CallError)) throw e
    return Response.json({ error: 'Refused', message: e.message }, {
      status: 400,
    })
  }
}

let BUILDERS: Row[] = [{
  name: 'builder_build',
  destructive: true,
  openWorld: true,
  input: {
    type: 'object',
    properties: {
      space: SPACE,
      app: APP,
      builder: str("the builder's id or alias"),
      only: {
        type: 'array',
        items: { type: 'string' },
        description: 'build only the bindings whose outer entities these ' +
          'name (ids or aliases), and leave the other builds as they are',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        description: 'build only the first n bindings, and leave the other ' +
          'builds as they are',
      },
      template: str(
        "a content.body template to try instead of the builder's own, as a " +
          'shadow variant',
      ),
      model: str(
        "a model to try instead of the builder's own, as a shadow variant",
      ),
    },
    required: ['app', 'builder'],
  },
  run: async (ctx, args) => {
    let { space, app, who, store } = await inApp(ctx, args, true)
    let ask: Ask & { by?: string } = {
      builder: text(args.builder, 'builder'),
      ...args.only == null
        ? {}
        : { only: (args.only as unknown[]).map(String) },
      ...args.limit == null ? {} : { limit: Number(args.limit) },
      ...args.template == null ? {} : { template: String(args.template) },
      ...args.model == null ? {} : { model: String(args.model) },
      ...who.person ? { by: who.person } : {},
    }
    let r = await store('/build', {
      method: 'POST',
      body: JSON.stringify(ask),
    }, KERNEL)
    let said = await r.json() as { builds?: string[]; message?: string }
    if (!r.ok) throw rejected(r.status, said.message ?? '')
    let builds = said.builds ?? []
    return {
      space,
      text: builds.length
        ? `reconciled ${builds.length} build${builds.length == 1 ? '' : 's'} ` +
          `of ${ask.builder} in ${space.slug}/${app.slug}; each asks its ` +
          `tool again only where its key moved:\n${builds.join('\n')}`
        : `${ask.builder} has no matching bindings in ${space.slug}/${app.slug}`,
      value: { builds },
    }
  },
}]

export let buildersPlugin: Plugin = {
  name: 'builders',
  tools: BUILDERS.map(worded),
  installs: [async (read, at) => {
    if (at.meta || !at.app) return []
    let row = toolRow(builderModelTool)
    let [have] = await read(`.entity.eid=${row.entity.eid}&*`)
    return JSON.stringify(have?.tool ?? null) == JSON.stringify(row.tool)
      ? []
      : [row]
  }],
  // Handled wherever the vocabulary declares builders, app or not: an effect
  // row owed to a handler this store never registers stays pending for good,
  // and keeps the store's alarm coming back for it.
  effects: [(on, at) => {
    let { vocab } = at.graph
    if (vocab.comp('builder')) on.handle(watches({ vocab }))
  }],
}

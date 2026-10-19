// The public configuration a Sessions control needs. The mute itself stays
// on the configured home project in the graph, shared by every follower.
import type { Route } from '@yaks/api'
import type { Graph } from '@yaks/graph'
import { home, type Options } from './fix.ts'

export type Control = { project?: string; configured: boolean }

/** Reveal only the home project and whether a fixer provider is configured. */
export let routes = (
  host: { graph: Graph },
  options: Options = {},
): Route[] => [{
  method: 'GET',
  path: '/heal/control',
  handle: async () =>
    Response.json(
      {
        project: await home(host.graph, options),
        configured: !!options.provider,
      } satisfies Control,
    ),
}]

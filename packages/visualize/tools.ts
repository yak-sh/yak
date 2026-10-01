// Agent doors use the same bounded, value-free DTOs as the HTTP routes.
// A tool observes its actual host, not another process serving the same store.

import type { Anatomy } from '@yaks/code/anatomy'
import { argsOf, type Bundle } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { capture } from './capture.ts'
import { select, type SelectOptions, snapshot } from './snapshot.ts'

/** Only the host's composed anatomy and its process-local trace channel. */
export type Host = {
  graph: object
  anatomy?: () => Anatomy
}

let selection = (args: Record<string, unknown>): SelectOptions => ({
  group: typeof args.group == 'string' ? args.group : undefined,
  search: typeof args.search == 'string' ? args.search : undefined,
  id: typeof args.id == 'string' ? args.id : undefined,
  limit: typeof args.limit == 'number' ? args.limit : undefined,
})

let answer = (eid: string, value: unknown): Bundle[] => [{
  entity: { eid },
  content: { body: JSON.stringify(value) },
}]

/** The implementations declared by ./vocab.json, loaded only on a call. */
export let runs = (host: Host): Runs => ({
  visualize_anatomy: (call) =>
    answer('$anatomy', select(snapshot(host), selection(argsOf(call)))),
  visualize_activity: async (call) => {
    let args = argsOf(call)
    let value = await capture(host.graph, {
      limit: typeof args.limit == 'number' ? args.limit : undefined,
      wait: typeof args.wait == 'number' ? args.wait : undefined,
    })
    return answer('$activity', value)
  },
})

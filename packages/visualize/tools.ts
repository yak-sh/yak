// Agent doors use the same bounded, value-free DTOs as the HTTP routes.
// A tool observes its actual host, not another process serving the same store.

import type { Anatomy } from '@yaks/code/anatomy'
import type { Bundle } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { who } from '@yaks/graph/call'
import type { Host as Hosting } from '@yaks/host'
import { CallError } from '@yaks/tools/errors'
import type { Runs } from '@yaks/graph/tools'
import { capture } from './capture.ts'
import { select, type SelectOptions, snapshot } from './snapshot.ts'

/** Only the host's composed anatomy and its process-local trace channel. */
export type Host = {
  graph: object
  anatomy?: () => Anatomy
  readJson?: Hosting['readJson']
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
  visualize_anatomy: async (call) => {
    let args = argsOf(call)
    if (args.url) {
      return answer(
        '$anatomy',
        await onward(host, 'anatomy', args, who(call)?.via),
      )
    }
    return answer('$anatomy', select(snapshot(host), selection(args)))
  },
  visualize_activity: async (call) => {
    let args = argsOf(call)
    if (args.url) {
      return answer(
        '$activity',
        await onward(host, 'activity', args, who(call)?.via),
      )
    }
    let value = await capture(host.graph, {
      limit: typeof args.limit == 'number' ? args.limit : undefined,
      wait: typeof args.wait == 'number' ? args.wait : undefined,
    })
    return answer('$activity', value)
  },
})

let onward = (
  host: Host,
  name: string,
  args: Record<string, unknown>,
  via?: string,
) => {
  if (!host.readJson) {
    throw new CallError('config', 'This host has no remote door')
  }
  let url = new URL(`/visualize/${name}`, String(args.url))
  for (
    let key of name == 'anatomy'
      ? ['group', 'search', 'id', 'limit']
      : ['wait', 'limit']
  ) {
    if (args[key] != null) url.searchParams.set(key, String(args[key]))
  }
  return host.readJson(url, { via })
}

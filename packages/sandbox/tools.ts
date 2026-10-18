// Persisted tool calls are the explicit creation and disposal doors.
import { argsOf, identityEid } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { sandboxDispose, sandboxNew } from './lifecycle.ts'
import {
  type Configuration,
  type ConfigurationHost,
  resolveOptions,
} from './configuration.ts'

/** Resolve implementation bindings at invocation, after the graph is open. */
export let runs = (
  host: ConfigurationHost,
  configuration: Configuration = {},
): Runs => ({
  sandbox_new: async (call, graph) => {
    let options = await resolveOptions(host, configuration)
    let args = argsOf(call)
    let row = await sandboxNew(graph, options.providers, {
      id: identityEid('sandbox', [call.entity.eid]),
      provider: String(args.provider),
      ...(args.machine ? { machine: String(args.machine) } : {}),
      ...(args.from ? { from: String(args.from) } : {}),
      ...(args.image ? { image: String(args.image) } : {}),
    })
    return [row]
  },
  sandbox_dispose: async (call, graph) => {
    let options = await resolveOptions(host, configuration)
    let args = argsOf(call)
    return [
      await sandboxDispose(graph, options.providers, String(args.sandbox)),
    ]
  },
})

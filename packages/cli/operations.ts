// The concrete host's operations are tools beside its plugins' tools, without
// making a config load its own CLI as a plugin.
import type { NamedTool } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import type { Host } from '@yaks/host'
import { CallError } from '@yaks/tools/errors'
import { said } from '@yaks/tools/result'
import { toolsIn } from '@yaks/vocab/tools'
import doc from './vocab.json' with { type: 'json' }
import { toolHelp } from './show.ts'
import { commandFor } from './run.ts'
import { restart, type RestartOptions } from './restart.ts'

export let definitions = toolsIn([doc])

export let operations = (
  host: Pick<Host, 'tools' | 'config'>,
  options?: RestartOptions,
): NamedTool[] =>
  definitions.map((tool) => ({
    ...tool,
    name: tool.name!,
    run: async (call) => {
      if (tool.name == 'restart') {
        let runtimeDir = options?.runtimeDir ?? Deno.env.get('XDG_RUNTIME_DIR')
        if (!runtimeDir) {
          throw new CallError(
            'config',
            'restart needs $XDG_RUNTIME_DIR',
          )
        }
        return [said(
          call,
          await restart({
            runtimeDir,
            processes: host.config.processes,
            ...options,
          }),
        )]
      }
      let words = (argsOf(call).words ?? []) as string[]
      let tools = host.tools
      if (!words.length) {
        return [said(call, tools.map((t) => t.name).join('\n'))]
      }
      let found = commandFor(tools, words)
      if (!found) {
        let group = tools.filter((t) => words.length == 1 && t.noun == words[0])
        if (group.length) {
          return [said(call, group.map((t) => t.name).join('\n'))]
        }
        throw new CallError(
          'arguments',
          `No tool named ${words.join(' ')}`,
        )
      }
      return [said(call, toolHelp(found.verb))]
    },
  }))

/** One read-only command shared by the CLI and MCP adapters. */
import { parse } from '@yaks/query'
import type { Tool } from '@yaks/graph'
import { toolDefinition } from '@yaks/vocab/tools'
import definition from './session-list.json' with { type: 'json' }

export const commands: Tool[] = [{
  ...toolDefinition(definition),
  run: (_args, ctx) => ctx.read(parse('.session')),
}]

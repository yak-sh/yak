/** One read-only command shared by the CLI and MCP adapters. */
import { parse } from '@yaks/query'
import { defineCommands } from '@yaks/cli/structured'

export const commands = defineCommands([{
  noun: ['session'],
  verb: 'list',
  aliases: [['list', 'session']],
  description: 'List sessions in the connected graph.',
  input: {},
  readOnly: true,
  run: (_args, ctx) => ctx.read(parse('.session')),
}])

// Commands belonging to a person at this terminal. Authorization has a
// private input and must never be stored as a tool call for later replay.

import type { CliCommand } from '@yaks/cli/host'
import { authorize } from './authorize.ts'
import { authorizeCLI } from './authorize_cli.ts'
import { hosted } from './store.ts'

let authorizeCommand: CliCommand = {
  name: 'connection_authorize',
  noun: 'connection',
  verb: 'authorize',
  description: 'List connections or sign in by title or alias. ' +
    'Paste the complete return URL into masked terminal input.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', description: 'connection title or alias' },
    },
  },
  options: { positional: ['name'] },
  run: async (args, host, context) => {
    let name = typeof args.name == 'string' ? args.name : undefined
    let result = await authorizeCLI(authorize(hosted(host)), name)
    context.out(result)
    return 0
  },
}

export let commands: CliCommand[] = [
  {
    name: 'session_tui',
    noun: 'session',
    verb: 'tui',
    description: 'Open the session TUI without creating a session.',
    run: async (_args, _host, context) => {
      let { open } = await import('./view.ts')
      await open(context.config!)
      return 0
    },
  },
  authorizeCommand,
  {
    ...authorizeCommand,
    name: 'auth',
    noun: undefined,
    verb: undefined,
  },
]

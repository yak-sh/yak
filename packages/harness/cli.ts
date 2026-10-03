// Commands belonging to a person at this terminal. Authorization has a
// private input and must never be stored as a tool call for later replay.

import type { CliCommand } from '@yaks/cli/host'
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
]

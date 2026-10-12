// A local command can restore already stamped bundles. The flag belongs to
// this filesystem door, never to a public graph tool's input or authority.

import { Usage } from './args.ts'
import type { Command, Ctx } from './run.ts'

export let restorable = (
  command: Command,
  restore: (args: Record<string, unknown>, c: Ctx) => Promise<number>,
): Command => ({
  ...command,
  inputSchema: {
    ...command.inputSchema,
    properties: {
      ...(command.inputSchema?.properties as Record<string, unknown> ?? {}),
      restore: {
        type: 'boolean',
        description: 'preserve supplied server-owned values in a local graph',
      },
      stamp: {
        type: 'boolean',
        description:
          'generate stamps during a local restoration (default: true)',
      },
    },
  },
  run: (args, c) => {
    let { restore: restoring, ...input } = args
    if (!restoring) {
      if (input.stamp !== undefined) throw new Usage('--stamp needs --restore')
      return command.run(input, c)
    }
    if (!c.config) {
      throw new Usage('--restore needs a local graph opened with --config')
    }
    return restore(input, c)
  },
})

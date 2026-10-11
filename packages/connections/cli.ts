// Terminal command declarations. Authorization loads only when yak auth runs.
import type { CliCommand } from '@yaks/cli/host'

export let commands: CliCommand[] = [{
  name: 'auth',
  description:
    'List integrations or sign in. Paste the complete return URL into masked terminal input.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', description: 'integration name or title' },
      key: {
        type: 'boolean',
        description: 'paste an agent grant or service key into masked input',
      },
      as: {
        type: 'string',
        description: 'outside account, when signing in without a browser',
      },
    },
  },
  positional: ['name'],
  run: async (args, host, context) =>
    (await import('./auth_command.ts')).auth(args, host, context),
}]

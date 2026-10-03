// Private terminal input belongs to connections, not to a model harness.
import { type CliCommand, person } from '@yaks/cli/host'
import { yaksApp } from './yaks-app.ts'
import { authorize } from './authorize.ts'
import { authorizeCLI } from './authorize_cli.ts'
export {
  type AuthIO,
  authIO,
  type Authorization,
  authorizeCLI,
  readHidden,
} from './authorize_cli.ts'
export let commands: CliCommand[] = [{
  name: 'auth',
  description:
    'List integrations or sign in. Paste the complete return URL into masked terminal input.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', description: 'integration name or title' },
      as: {
        type: 'string',
        description: 'outside account, when signing in without a browser',
      },
    },
  },
  positional: ['name'],
  run: async (args, host, context) => {
    context.out(
      await authorizeCLI(
        authorize({
          graph: host.graph,
          vault: host.vault,
          owner: await person(host),
        }, yaksApp({ graph: host.graph, vault: host.vault })),
        typeof args.name == 'string' ? args.name : undefined,
        undefined,
        typeof args.as == 'string' ? args.as : context.as,
      ),
    )
    return 0
  },
}]

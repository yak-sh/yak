// Private terminal input belongs to connections, not to a model harness.
import { type CliCommand, person } from '@yaks/cli/host'
import { yaksApp } from './yaks-app.ts'
import { authorize } from './authorize.ts'
import { Refused } from '@yaks/graph'
import { connect, need, pick } from './connections.ts'
import { authIO } from './authorize_cli.ts'
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
  run: async (args, host, context) => {
    if (args.key) {
      let integration = typeof args.name == 'string' ? args.name : undefined
      if (!integration) {
        throw new Refused('name the integration for the pasted key')
      }
      let owner = await person(host)
      if (!owner) {
        throw new Refused('a configured person is required to connect a key')
      }
      let as = typeof args.as == 'string' ? args.as : context.as
      if (integration == 'yaks.app') {
        await yaksApp(host).prepare!(integration, as)
      }
      authIO.say('Paste the key and press Enter (input hidden):')
      let key = await authIO.hidden()
      if (!key) throw new Refused('No key supplied')
      let existing = as
        ? await pick(host.graph.read, owner, integration, as).catch(() =>
          undefined
        )
        : undefined
      let [b] = existing ? [existing] : await host.graph.apply(
        await need(host.graph.read, { owner, integration }),
      )
      await connect({ graph: host.graph, vault: host.vault }, b.entity.eid, {
        key,
      }, as)
      context.out(`${integration} connected.`)
      return 0
    }
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

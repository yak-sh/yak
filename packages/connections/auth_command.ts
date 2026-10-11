// The terminal sign-in command: private input goes directly to authorization
// and the vault, never through a stored tool call.
import type { CliCommand } from '@yaks/cli/host'
import { person } from '@yaks/cli/config'
import { yaksApp } from './yaks-app.ts'
import { authorize } from './authorize.ts'
import { Refused } from '@yaks/graph'
import { connect, need, pick } from './connections.ts'
import { authIO, authorizeCLI } from './authorize_cli.ts'

export let auth: CliCommand['run'] = async (args, host, context) => {
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
}

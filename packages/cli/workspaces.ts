import { importing } from '@yaks/fp/imports'
// Bind explicitly configured computer transports to existing workspace records.
// No connector is enabled by the graph server's own launch directory.
import type { Config, Host } from '@yaks/host'
import { localConnector, sshConnector } from '@yaks/machine/connectors'
import { workspaces } from '@yaks/machine/workspaces'
import type { ComputerConnector } from '@yaks/machine'
import { resolveOptions } from '@yaks/sandbox/configuration'
import { sandboxConnect } from '@yaks/sandbox/lifecycle'

export let workspaceCapabilities = (
  host: Pick<Host, 'graph'>,
  config: Config,
): Host['workspaces'] => {
  // This CLI already has the local computer's OS doors. Availability does not
  // select a workspace, and remote/unknown placements still never go local.
  let configured = config.workspaces ?? {
    connectors: {},
    receipts: config.db && config.db != ':memory:'
      ? (config.db.slice(0, config.db.lastIndexOf('/')) || '.') +
        '/workspace-receipts'
      : (Deno.env.get('TMPDIR') ?? '/tmp') + '/yak-workspace-receipts-' +
        Deno.uid(),
  }
  return {
    connect: async (id) => {
      let connectors: Record<string, ComputerConnector> = {
        local: localConnector(),
      }
      for (let [name, source] of Object.entries(configured.connectors)) {
        if (source.use == '@yaks/machine/local') {
          connectors[name] = localConnector()
        } else if (source.use == '@yaks/machine/ssh') {
          connectors[name] = sshConnector(source.with)
        } else {
          let loaded = await importing(import.meta.resolve(source.use))
          if (typeof loaded.connector != 'function') {
            throw new Error(
              'Connector module must export connector: ' + source.use,
            )
          }
          connectors[name] = await loaded.connector(source.with ?? {})
        }
      }
      return await workspaces(host.graph, {
        connectors,
        receipts: configured.receipts,
        sandbox: async (id) =>
          (await sandboxConnect(
            host.graph,
            (await resolveOptions(host, config.sandboxes)).providers,
            id,
          )).workspace,
      }).connect(id)
    },
  }
}

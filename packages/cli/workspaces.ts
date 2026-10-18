// Bind explicitly configured computer transports to existing workspace records.
// No connector is enabled by the graph server's own launch directory.
import type { Config, Host } from '@yaks/host'
import { localConnector, sshConnector } from '@yaks/machine/connectors'
import { workspaces } from '@yaks/machine/workspaces'
import type { ComputerConnector } from '@yaks/machine'

export let workspaceCapabilities = (
  host: Pick<Host, 'graph'>,
  config: Config,
): Host['workspaces'] => {
  if (!config.workspaces) return undefined
  let configured = config.workspaces
  return {
    connect: async (id) => {
      let connectors: Record<string, ComputerConnector> = {}
      for (let [name, source] of Object.entries(configured.connectors)) {
        if (source.use == '@yaks/machine/local') {
          connectors[name] = localConnector()
        } else if (source.use == '@yaks/machine/ssh') {
          connectors[name] = sshConnector(source.with)
        } else {
          let loaded = await import(source.use)
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
      }).connect(id)
    },
  }
}

// Bind sandbox intentions separately from existing computer transports.
import { Refused } from '@yaks/graph'
import { unlent } from '@yaks/machine/targets'
import type { Config, Host } from '@yaks/host'
import { resolveOptions } from '@yaks/sandbox/configuration'
import { sandboxNew } from '@yaks/sandbox/lifecycle'

export let sandboxCapabilities = (
  host: Pick<Host, 'graph'>,
  config: Config,
): NonNullable<Host['sandboxes']> => ({
  request: async (id, request = {}) => {
    let provider = request.provider ?? config.sandboxes?.defaultProvider
    if (!provider) {
      throw await unlent(host.graph)
    }
    let { providers } = await resolveOptions(host, config.sandboxes)
    let binding = providers[provider]
    if (!binding) {
      throw new Refused('Sandbox provider is not configured: ' + provider)
    }
    await sandboxNew(host.graph, providers, {
      ...request,
      id,
      provider,
      machine: binding.machine,
    })
    return id
  },
})

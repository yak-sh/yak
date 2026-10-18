// Bind sandbox intentions separately from existing computer transports.
import type { Config, Host } from '@yaks/host'
import { resolveOptions } from '@yaks/sandbox/configuration'
import { sandboxNew } from '@yaks/sandbox/lifecycle'

export let sandboxCapabilities = (
  host: Host,
  config: Config,
): NonNullable<Host['sandboxes']> => ({
  request: async (id, request = {}) => {
    let provider = request.provider ?? config.sandboxes?.defaultProvider
    if (!provider) {
      throw new Error('This host lends no default sandbox provider')
    }
    let { providers } = await resolveOptions(host, config.sandboxes)
    let binding = providers[provider]
    if (!binding) {
      throw new Error('Sandbox provider is not configured: ' + provider)
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

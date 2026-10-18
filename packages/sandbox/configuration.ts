// JSON configuration binds adapters to explicit computer rows. A module may
// supply backend-specific SDK bindings without putting SDKs in generic lifecycle.
import type { Comp, Graph } from '@yaks/graph'
import {
  computer,
  localConnector,
  sshConnector,
} from '@yaks/machine/connectors'
import type { SandboxBinding, SandboxOptions } from './lifecycle.ts'
import type { SandboxProvider } from './provider.ts'

type Descriptor = {
  use: string
  machine?: string
  with?: Record<string, unknown>
}
export type Configuration = {
  providers?: Record<string, SandboxBinding | Descriptor>
}
export type ConfigurationHost = {
  graph: Graph
  config?: { sandboxes?: Configuration }
}

/** Adapter modules export sandboxProvider(host, options, placement). Built-in
 * Docker/PVE bindings use only their machine row's configured local/SSH address.
 * No missing placement becomes the server computer. */
export let resolveOptions = async (
  host: ConfigurationHost,
  options: Configuration = {},
): Promise<SandboxOptions> => {
  let providers: SandboxOptions['providers'] = {}
  for (
    let [name, entry] of Object.entries(
      options.providers ?? host.config?.sandboxes?.providers ?? {},
    )
  ) {
    if ('provider' in entry) {
      providers[name] = entry
      continue
    }
    let settings = entry.with ?? {}
    let transport
    if (entry.machine) {
      let [row] = await host.graph.get([entry.machine])
      if (!row?.machine) {
        throw new Error('Sandbox computer is missing: ' + entry.machine)
      }
      transport = await computer(
        (row.machine as Comp).address as string | undefined,
        {
          local: localConnector(),
          ssh: sshConnector({
            identity: typeof settings.identity == 'string'
              ? settings.identity
              : undefined,
            knownHosts: typeof settings.knownHosts == 'string'
              ? settings.knownHosts
              : undefined,
          }),
        },
      )
    }
    let provider: SandboxProvider
    if (
      entry.use == '@yaks/sandbox/docker' || entry.use == '@yaks/sandbox/pve'
    ) {
      if (!transport) {
        throw new Error(
          'Sandbox adapter requires an explicit computer: ' + name,
        )
      }
      if (typeof settings.state != 'string') {
        throw new Error(
          'Sandbox adapter requires a durable host state directory',
        )
      }
      if (entry.use == '@yaks/sandbox/docker') {
        let { dockerSandboxes } = await import('./docker.ts')
        provider = dockerSandboxes(host.graph, {
          transport,
          state: settings.state,
          ...(typeof settings.root == 'string' ? { root: settings.root } : {}),
          ...(typeof settings.image == 'string'
            ? { image: settings.image }
            : {}),
        })
      } else {
        let { pveClones } = await import('./pve.ts')
        if (
          typeof settings.template != 'number' ||
          typeof settings.storage != 'string' ||
          !Array.isArray(settings.vmidRange) || settings.vmidRange.length != 2
        ) {
          throw new Error(
            'PVE binding requires template, storage and vmidRange',
          )
        }
        provider = pveClones(host.graph, {
          transport,
          state: settings.state,
          template: settings.template,
          storage: settings.storage,
          vmidRange: settings.vmidRange as [number, number],
        })
      }
    } else {
      // Module factories also serve Cloudflare bindings and local jail options.
      let module = await import(entry.use)
      if (typeof module.sandboxProvider != 'function') {
        throw new Error(
          'Sandbox module must export sandboxProvider: ' + entry.use,
        )
      }
      provider = await module.sandboxProvider(host, settings, {
        machine: entry.machine,
        transport,
      })
    }
    providers[name] = {
      provider,
      ...(entry.machine ? { machine: entry.machine } : {}),
    }
  }
  return { providers }
}

/** Browse's terminal commands serve `web` in their own process: the graph
 * they open answers the terminal's HTTP and subscriptions on a loopback port
 * of its own, so no `yak serve` need run first, and other processes' commits
 * still arrive through the host's feed. `--app` browses a yaks.app store
 * instead; configured domains supply views. */
import type { CliCommand, Host } from '@yaks/cli/host'
import { subpath, used } from '@yaks/cli/config'

// This process's own web, on a port nobody else asked for.
let listen = async (host: Host) => {
  if (!host.handler) {
    throw new Error('browse has no handler — compose @yaks/api')
  }
  let { denoListen } = await import('@yaks/api')
  let at = Promise.withResolvers<string>()
  let server = denoListen({
    port: 0,
    hostname: '127.0.0.1',
    onListen: ({ hostname, port }) => at.resolve(`http://${hostname}:${port}`),
  }, host.handler)
  return {
    url: await at.promise,
    close: async () => {
      await server.shutdown()
      await server.finished
    },
  }
}

export let commands: CliCommand[] = ['browse', 'inspect'].map((name) => ({
  name,
  description: name == 'browse'
    ? 'Browse the graph in this terminal.'
    : 'Browse an Inspect page: the map, an id, or a query.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      app: { type: 'string', description: 'a yaks.app app: slug or space/app' },
      what: { type: 'string', description: 'id or query to open' },
    },
  },
  positional: ['what'],
  roles: ['web'],
  run: async (args, host, context) => {
    let own: Awaited<ReturnType<typeof listen>> | undefined
    try {
      let connection = typeof args.app == 'string'
        ? await (await import('./remote.ts')).remote(
          args.app,
          context.host,
          context.state,
          undefined,
          { config: context.config, as: context.as },
        )
        : { url: (own = await listen(host)).url, wire: {} }
      let { open } = await import('./terminal.ts')
      let { onFailure } = await import('./failure.ts')
      let restore = onFailure((error, place) => {
        void host.report?.(error, {
          tags: { step: 'render', place, command: `yak ${name}` },
        })
      })
      try {
        await open(connection.url, {
          what: String(args.what ?? ''),
          inspect: name == 'inspect',
          wire: connection.wire,
          facets: async () =>
            (await Promise.all(
              (host.config.plugins ?? []).map((p) =>
                subpath<import('./components/inspect.tsx').Facet>(
                  used(p),
                  'views',
                )
              ),
            )).filter((f) => f != null),
        })
      } finally {
        restore()
      }
      return 0
    } catch (error) {
      await host.report?.(error, {
        tags: { step: 'terminal', command: `yak ${name}` },
      })
      context.note(
        error instanceof Error ? error.stack ?? error.message : String(error),
      )
      return 1
    } finally {
      await own?.close()
    }
  },
}))

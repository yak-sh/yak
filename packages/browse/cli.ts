/** Browse's terminal commands load no server duties: the configured server
 * supplies the vocabulary and subscriptions; configured domains supply views. */
import type { CliCommand } from '@yaks/cli/host'
import { subpath, used } from '@yaks/cli/config'

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
  run: async (args, host, context) => {
    try {
      let { PORT } = await import('@yaks/api/tools')
      let hostname = host.config.hostname
      let url = `http://${
        !hostname || hostname == '0.0.0.0' ? '127.0.0.1' : hostname
      }:${host.config.port ?? PORT}`
      let connection = typeof args.app == 'string'
        ? await (await import('./remote.ts')).remote(
          args.app,
          context.host,
          context.state,
          undefined,
          { config: context.config, as: context.as },
        )
        : { url, wire: {} }
      let { open } = await import('./terminal.ts')
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
      return 0
    } catch (error) {
      context.note(
        error instanceof Error ? error.stack ?? error.message : String(error),
      )
      return 1
    }
  },
}))

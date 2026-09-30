/**
 * The cli facet, exported as `@yaks/inspect/cli`: `yak inspect`, the
 * inspector held in this terminal (./tui.ts). It reads through the server
 * this config's `yak serve` runs, the way the page does: a client of it, like
 * any other command, taking none of its roles.
 *
 * @module
 */

import type { CliCommand } from '@yaks/cli/host'

/** `yak inspect [what]`: the map, a query run on it, or an entity's page. */
export let commands: CliCommand[] = [{
  name: 'inspect',
  description: 'Open the inspector in this terminal: the map of every ' +
    'component, archetype and package, a query run on it, or an entity. ' +
    'It reads through yak serve.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      what: {
        type: 'string',
        description: 'an id to open (T-9), or a query to run on the map',
      },
    },
  },
  options: { positional: ['what'] },
  // What it runs is imported when it runs: every command line lists this one.
  run: async (args, host, context) => {
    let { PORT } = await import('@yaks/api/tools')
    let { hostname, port = PORT } = host.config
    let url = `http://${
      !hostname || hostname == '0.0.0.0' ? '127.0.0.1' : hostname
    }:${port}`
    let { open, start } = await import('./tui.ts')
    let { contributed } = await import('./plugins.ts')
    let more = (await contributed(host.config.plugins ?? []))
      .flatMap((c) => c.views)
    try {
      await open(
        url,
        start(typeof args.what == 'string' ? args.what : ''),
        more,
      )
      return 0
    } catch (e) {
      context.note(e instanceof Error ? e.message : String(e))
      return 1
    }
  },
}]

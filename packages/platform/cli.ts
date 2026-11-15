// `yak release serve <dir>`: an app's release directory served on this
// machine as the store yaks.app keeps for it (./released.ts).
import type { CliCommand } from '@yaks/cli/host'

export let commands: CliCommand[] = [{
  name: 'release_serve',
  noun: 'release',
  verb: 'serve',
  description:
    'Serve an app’s release directory on this machine: its vocab.json as the ' +
    'words of a store composed the way yaks.app composes an app’s, answering ' +
    'through POST /apply, /query, the /ws socket and /mcp until stopped.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['dir'],
    properties: {
      dir: { type: 'string', description: 'the release directory' },
      db: {
        type: 'string',
        description:
          'the store’s SQLite file, or :memory: (default .yak/store.db in ' +
          'the release directory)',
      },
      port: { type: 'number', description: 'the port to listen on' },
      hostname: { type: 'string', description: 'the interface to bind' },
    },
  },
  positional: ['dir'],
  run: async (args, host) => {
    let { serve } = await import('./released.ts')
    let { dir, ...at } = args as {
      dir: string
      db?: string
      port?: number
      hostname?: string
    }
    return await serve(dir, at, host.stopping) ? 0 : 1
  },
}]

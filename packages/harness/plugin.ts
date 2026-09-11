/** Experimental session contributions; no database, worker, or server is started. */
import type { Manifest } from '@yaks/plugin'

const manifest: Manifest = {
  api: 1,
  id: '@yaks/harness',
  contributions: [
    {
      name: 'session-vocabulary',
      target: 'vocabulary',
      load: async () => (await import('@yaks/session')).sessionDoc,
    },
    {
      name: 'session-rules',
      target: 'graph.plugins',
      load: async () => (await import('@yaks/session')).sessions(),
    },
    {
      name: 'session-commands',
      target: 'commands',
      load: async () => (await import('./commands.ts')).commands,
    },
  ],
}
export default manifest

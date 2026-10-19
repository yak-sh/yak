// Commands belonging to a person at this terminal. Authorization has a
// private input and must never be stored as a tool call for later replay.

import type { CliCommand } from '@yaks/cli/host'
export let commands: CliCommand[] = [
  {
    name: 'session_tui',
    noun: 'session',
    verb: 'tui',
    description: 'Open the session TUI without creating a session.',
    run: async (_args, _host, context) => {
      let { open } = await import('./view.ts')
      await open(context.config!)
      return 0
    },
  },
]

/** The local command supplies its own filesystem context before the stored
 * session_new call. A remote invocation never observes the server cwd. */
export let tools = {
  session_new: async (
    args: Record<string, unknown>,
    context: { config?: string; duties: boolean },
  ): Promise<undefined> => {
    if (args.workspace != null) return undefined
    let { compose, read } = await import('@yaks/cli/host')
    let { homeAt } = await import('./workspace.ts')
    let host = await compose(
      { ...read(context.config!), duties: false },
      ['graph'],
      undefined,
      { process: false },
    )
    try {
      let home = await homeAt(host.graph, Deno.cwd())
      if (home.workspace) {
        args.workspace = home.workspace
        args.cwd ??= home.cwd
      }
    } finally {
      await host.close()
    }
    return undefined
  },
}

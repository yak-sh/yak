// Host preparation of a native fixer's explicitly configured worktree.
import type { Config, Host } from '@yaks/host'
import { given, used } from '@yaks/host/config'
export let resolveHome =
  (host: Host, config: Config): NonNullable<Host['resolveHome']> =>
  async (session) => {
    let [owner] = await host.graph.get([session])
    if (!owner?.session || !owner.fixer || !owner.native) return
    let spawn = config.plugins?.find((plug) => used(plug) == '@yaks/spawn')
    let options = spawn ? given(spawn) : {}
    if (typeof options.worktrees != 'string' || !options.worktrees) {
      throw new Error('Native fixer worktrees require @yaks/spawn worktrees')
    }
    if (!host.workspaces) {
      throw new Error(
        'Native fixer workspaces require configured workspace connectors',
      )
    }
    let { createWorktree } = await import('@yaks/git/host')
    let tree = await createWorktree(
      host.graph,
      typeof options.cwd == 'string' ? options.cwd : Deno.cwd(),
      {
        path: `${options.worktrees}/${session}`,
        branch: `session-${session}`,
      },
    )
    let cwd = String((tree.workspace as { root: string }).root)
    return { workspace: tree.entity.eid, cwd }
  }

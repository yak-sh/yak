import * as system from '@yaks/process/system'
// Host preparation of the checkout a native session does a project's work in:
// that of a session holding a task (one started on a person's comment,
// @yaks/session `starting`, or a lander, @yaks/harness/isolated), which gets
// what a spawned run has, its own worktree cut from the checkout @yaks/spawn's
// config names. A fixer works in a sandbox of its own, never a checkout of the
// host's; a session holding nothing is not the host's to place either.
import type { Graph } from '@yaks/graph'
import { line } from '@yaks/query'
import type { Config, Host } from '@yaks/host'
import { given, used } from '@yaks/host/config'

/** Whether a native session works on a task it holds the claim on, and so
 * wants a checkout of its own. Never a fixer (`fixer{bug}`), nor a session an
 * outside CLI runs. */
export let working = async (
  g: Pick<Graph, 'get' | 'read'>,
  session: string,
): Promise<boolean> => {
  let [owner] = await g.get([session])
  if (!owner?.session || !owner.native || owner.fixer) return false
  let held = await g.read(
    line`.claim.session=${session}&.task&.limit=1&.fields=entity.eid`,
  )
  return held.length > 0
}

export let resolveHome =
  (host: Host, config: Config): NonNullable<Host['resolveHome']> =>
  async (session) => {
    if (!await working(host.graph, session)) return
    let spawn = config.plugins?.find((plug) => used(plug) == '@yaks/spawn')
    let options = spawn ? given(spawn) : {}
    let worktrees = typeof options.worktrees == 'string'
      ? options.worktrees
      : ''
    // A host with no place to cut a worktree leaves the session to its
    // sandboxes, as one holding nothing is.
    if (!(worktrees && host.workspaces)) return
    let { createWorktree } = await import('@yaks/git/host')
    let tree = await createWorktree(
      host.graph,
      typeof options.cwd == 'string' ? options.cwd : system.cwd(),
      {
        path: `${worktrees}/${session}`,
        branch: `session-${session}`,
      },
    )
    let cwd = String((tree.workspace as { root: string }).root)
    return { workspace: tree.entity.eid, cwd }
  }

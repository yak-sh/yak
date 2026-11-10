import * as system from '@yaks/process/system'
// Host preparation of the checkout a native session does a project's work in:
// a fixer's, and that of a session holding a task (one started on a person's
// comment, @yaks/session `starting`), which gets what a spawned run has, its
// own worktree cut from the checkout @yaks/spawn's config names. A session
// doing neither is not the host's to place.
import type { Graph } from '@yaks/graph'
import type { Config, Host } from '@yaks/host'
import { given, used } from '@yaks/host/config'

/** What a native session is doing that wants a checkout of its own: fixing a
 * bug (`fixer{bug}`), or work on a task it holds the claim on. Nothing for a
 * session doing neither, or one an outside CLI runs. */
export let working = async (
  g: Pick<Graph, 'get' | 'read'>,
  session: string,
): Promise<'fixer' | 'task' | undefined> => {
  let [owner] = await g.get([session])
  if (!owner?.session || !owner.native) return
  if (owner.fixer) return 'fixer'
  let held = await g.read(
    `.claim.session=${session}&.task&.limit=1&.fields=entity.eid`,
  )
  return held.length ? 'task' : undefined
}

export let resolveHome =
  (host: Host, config: Config): NonNullable<Host['resolveHome']> =>
  async (session) => {
    let work = await working(host.graph, session)
    if (!work) return
    let spawn = config.plugins?.find((plug) => used(plug) == '@yaks/spawn')
    let options = spawn ? given(spawn) : {}
    let worktrees = typeof options.worktrees == 'string'
      ? options.worktrees
      : ''
    // A session on a task, on a host with no place to cut a worktree, is left
    // to the host's sandboxes, as a session holding nothing is.
    if (work == 'task' && !(worktrees && host.workspaces)) return
    if (!worktrees) {
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
      typeof options.cwd == 'string' ? options.cwd : system.cwd(),
      {
        path: `${worktrees}/${session}`,
        branch: `session-${session}`,
      },
    )
    let cwd = String((tree.workspace as { root: string }).root)
    return { workspace: tree.entity.eid, cwd }
  }

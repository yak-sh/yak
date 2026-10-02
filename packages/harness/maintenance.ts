// Worktree maintenance is shared by an explicit resume and the host's service.
// The service owns the schedule; a resume awaits its pass before starting work.
import type { Graph } from '@yaks/graph'
import { going, homes, sweep } from './worktrees.ts'

export let tidy = async (g: Graph, root: string): Promise<void> => {
  let kept = await sweep(g, root, await homes(g, await going(g), root))
  let failed = Object.keys(kept).filter((path) => kept[path] == 'failed')
  if (failed.length) {
    throw new Error('Worktree sweep could not remove: ' + failed.join(', '))
  }
}

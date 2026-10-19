// A local root opening selects the checkout where its caller is standing.
// This is an explicit CLI/filesystem boundary, never a remote host fallback.
import type { Comp, Graph } from '@yaks/graph'
import { checkoutAt } from '@yaks/git/host'

/** Observe the local checkout, keeping its root separate from the command
 * directory. Outside Git there is no checkout default to lend. */
export let homeAt = async (g: Graph, cwd: string): Promise<Comp> => {
  if (!['workspace', 'worktree', 'repository'].every((c) => g.vocab.comp(c))) {
    return {}
  }
  let directory = await Deno.realPath(cwd)
  let checkout = await checkoutAt(g, directory)
  return checkout ? { workspace: checkout.entity.eid, cwd: directory } : {}
}

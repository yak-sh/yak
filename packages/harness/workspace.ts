/** Thin session integration over @yaks/git's host checkout model. */
import { checkoutAt, createWorktree, discover } from '@yaks/git/host'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { ChildLimits } from '@yaks/session'

export { workspaceDoc } from './vocab.ts'

let row = async (g: Graph, eid: string) =>
  (await g.storage.tx((tx) => tx.get([eid])))[0]
export let homeAt = async (g: Graph, cwd: string): Promise<Comp> => {
  let tree = await checkoutAt(g, cwd)
  return { ...(tree ? { worktree: tree.entity.eid } : {}), cwd }
}
export let sessionCwd = async (g: Graph, session: string, fallback: string) => {
  let owner = await row(g, session)
  let home = owner?.home as Comp | undefined
  // Existing sessions are attached lazily on first shell use after upgrading.
  if (!home && owner?.session) {
    home = await homeAt(g, fallback)
    await g.apply([{ entity: owner.entity, home }])
  }
  if (home?.cwd) return String(home.cwd)
  if (home?.worktree) {
    let tree = (await row(g, String(home.worktree)))?.worktree as
      | Comp
      | undefined
    if (!tree?.path) throw new Error('session home worktree is missing')
    return String(tree.path)
  }
  return fallback
}
export let workspace = (g: Graph, cwd = Deno.cwd()): ChildLimits => ({
  taskDefaults: async (parent, child) => {
    let inherited = (await row(g, parent))?.home as Comp | undefined
    let tree = inherited?.worktree
      ? await row(g, String(inherited.worktree))
      : await checkoutAt(g, await sessionCwd(g, parent, cwd))
    let path = (tree?.worktree as Comp | undefined)?.path
    if (!path) {
      throw new Error(
        'Task worktree requires a Git repository; start the parent in a checkout',
      )
    }
    let observed = await discover(g, String(path))
    let head = (observed.worktree as Comp).head
    if (!head) throw new Error('Task worktree requires a committed HEAD')
    let directory = Deno.env.get('HARNESS_WORKTREE_DIR') ??
      `${Deno.env.get('HOME')}/.harness/worktrees`
    return {
      worktree: {
        path: `${directory}/${child.replaceAll(':', '-')}`,
        base: String(head),
        branch: 'task-' + child.replaceAll(':', '-'),
      },
    }
  },
  childProperties: {
    worktree: {
      type: 'object',
      description:
        'Explicitly create a Git checkout (committed base only). Omit to share parent home. No sandbox or automatic cleanup.',
      properties: {
        path: { type: 'string' },
        base: {
          type: 'string',
          description:
            'commit-ish, default parent checkout HEAD; dirty files are not copied',
        },
        branch: {
          type: 'string',
          description: 'new branch short name; omit for detached HEAD',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    home: {
      type: 'string',
      description:
        'Attach to an existing worktree entity as agent home, without creating a checkout. Mutually exclusive with worktree.',
    },
    cwd: {
      type: 'string',
      description:
        'Default command directory, distinct from Git worktree home. Absolute path.',
    },
  },
  prepareChild: async ({ parent, args }) => {
    if (args.home != null && args.worktree != null) {
      throw new Error('choose home or worktree, not both')
    }
    let inherited = (await row(g, parent))?.home as Comp | undefined ??
      await homeAt(g, cwd)
    let home: Comp = { ...inherited }
    if (args.home != null) {
      let tree = (await row(g, String(args.home)))?.worktree as Comp | undefined
      if (!tree?.path) throw new Error('home must name a worktree entity')
      let observed = await discover(g, String(tree.path))
      if (observed.entity.eid != args.home) {
        throw new Error('home checkout identity changed')
      }
      home = { worktree: observed.entity.eid }
    }
    if (args.worktree != null) {
      let request = args.worktree as Record<string, unknown>
      if (
        !request || typeof request.path != 'string' ||
        !request.path.startsWith('/')
      ) throw new Error('worktree.path must be absolute')
      if (
        request.base != null && typeof request.base != 'string' ||
        request.branch != null && typeof request.branch != 'string'
      ) throw new Error('base and branch must be strings')
      let source = await sessionCwd(g, parent, cwd)
      if (inherited.worktree) {
        let tree = (await row(g, String(inherited.worktree)))?.worktree as
          | Comp
          | undefined
        if (!tree?.path) throw new Error('parent worktree missing')
        source = String(tree.path)
      }
      let tree = await createWorktree(g, source, {
        path: request.path,
        base: request.base as string | undefined,
        branch: request.branch as string | undefined,
      })
      home = { worktree: tree.entity.eid }
    }
    if (args.cwd != null) {
      if (typeof args.cwd != 'string' || !args.cwd.startsWith('/')) {
        throw new Error('cwd must be absolute')
      }
      home.cwd = args.cwd
    }
    return { home } as Omit<Bundle, 'entity'>
  },
})

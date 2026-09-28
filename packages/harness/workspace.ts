/** A thin layer connecting sessions to @yaks/git's local checkout model. The
 * directory a session starts in and the root its children's checkouts are cut
 * under are the host's to say (./local.ts). */
import { checkoutAt, createWorktree, discover, restore } from '@yaks/git/host'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { type Snapshot, snapshot } from '@yaks/context'
import { owed } from '@yaks/persona'
import type { ChildLimits } from '@yaks/session'
import { cutFor } from './worktrees.ts'

export { workspaceDoc } from './vocab.ts'

let row = async (g: Graph, eid: string) => (await g.get([eid]))[0]
let absolute = (description: string) => ({
  type: 'string',
  pattern: '^/',
  description,
})
/** Where a worktree entity is checked out — the one function everything here
 * goes through, so a worktree removed while its session was over is created
 * again before anything runs in it (@yaks/git/host `restore`). */
let treeAt = async (g: Graph, eid: string): Promise<string> => {
  let tree = await row(g, eid)
  if (!tree?.worktree) throw new Error('not a worktree entity: ' + eid)
  return restore(g, tree)
}
export let homeAt = async (g: Graph, cwd: string): Promise<Comp> => {
  let tree = await checkoutAt(g, cwd)
  return { ...(tree ? { worktree: tree.entity.eid } : {}), cwd }
}
/** What a session opening at `home` is owed beside the instruction files it
 * found there: its chosen persona, or the checkout's common persona by
 * default, as one snapshot unless a file already says it. */
export let owing = async (
  g: Graph,
  home: Comp,
  files: Snapshot[],
  persona?: string,
): Promise<Snapshot[]> => {
  let [tree] = home.worktree ? await g.get([String(home.worktree)]) : []
  let path = (tree?.worktree as Comp | undefined)?.path
  let owes = path == null && !persona
    ? undefined
    : await owed(g, String(path ?? ''), files.map((f) => f.body), persona)
  return owes ? [await snapshot(owes.text, owes.source)] : []
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
  if (home?.worktree) return treeAt(g, String(home.worktree))
  return fallback
}
export let workspace = (g: Graph, cwd: string, root: string): ChildLimits => ({
  taskDefaults: async (parent, child) => {
    let inherited = (await row(g, parent))?.home as Comp | undefined
    let path = inherited?.worktree
      ? await treeAt(g, String(inherited.worktree))
      : ((await checkoutAt(g, await sessionCwd(g, parent, cwd)))
        ?.worktree as Comp | undefined)?.path
    if (!path) {
      throw new Error(
        'Task worktree requires a Git repository; start the parent in a checkout',
      )
    }
    let observed = await discover(g, String(path))
    let head = (observed.worktree as Comp).head
    if (!head) throw new Error('Task worktree requires a committed HEAD')
    return {
      worktree: {
        // Named after the child, so worktrees.ts knows whose checkout it is
        // without asking the graph — and never mistakes an inherited home for
        // one of its own.
        path: cutFor(child, root),
        base: String(head),
        branch: 'task-' + child.replaceAll(':', '-'),
      },
    }
  },
  childProperties: {
    worktree: {
      type: 'object',
      description:
        'Explicitly create a Git checkout (committed base only). Omit to share parent home. No sandbox; a path of your own choosing is never reclaimed when the session ends.',
      properties: {
        path: absolute('Absolute path for the new checkout.'),
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
    home: absolute(
      'Absolute path to an existing Git checkout to use as agent home, or as the source of a new worktree.',
    ),
    cwd: absolute(
      'Default command directory, distinct from Git worktree home. Absolute path.',
    ),
  },
  prepareChild: async ({ parent, args }) => {
    let inherited = (await row(g, parent))?.home as Comp | undefined ??
      await homeAt(g, cwd)
    let home: Comp = { ...inherited }
    if (args.home != null) {
      if (typeof args.home != 'string' || !args.home.startsWith('/')) {
        throw new Error('home must be an absolute Git checkout path')
      }
      let path = await Deno.realPath(args.home)
      let observed = await checkoutAt(g, path)
      if (!observed) throw new Error('home is not a Git checkout: ' + path)
      if ((observed.worktree as Comp).path != path) {
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
      let source = home.worktree
        ? await treeAt(g, String(home.worktree))
        : await sessionCwd(g, parent, cwd)
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

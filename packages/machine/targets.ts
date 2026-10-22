// Resolve file-and-command targets once. A session default is only a convenience;
// process recovery always follows its original workspace.
import { type Bundle, type Comp, type Graph, Refused } from '@yaks/graph'
import { token } from '@yaks/graph/guard'
import type { Workspace } from './workspace.ts'

export type Workspaces = {
  connect: (workspace: string) => Promise<Workspace>
}
export type Target = { workspace: string; cwd: string }
let component = (value: unknown) => value as Comp | undefined

/**
 * How a call names a workspace, and some it could name: the second half of
 * every refusal for a call that named none, or named something else. The
 * newest workspaces, one per directory, since many share one.
 */
export let naming = async (g: Graph): Promise<string> => {
  let newest = g.vocab.comp('created') ? '&.order=-created.at' : ''
  let rows = await g.read(`.workspace${newest}&.limit=40&*`)
  let roots = new Map<string, string>()
  for (let row of rows) {
    let root = component(row.workspace)?.root
    if (row.released || typeof root != 'string' || roots.has(root)) continue
    roots.set(root, row.entity.eid)
  }
  let some = [...roots].slice(0, 5).map(([root, eid]) => `${eid} (${root})`)
  return "workspace takes a workspace entity's eid" +
    (some.length ? `, such as ${some.join(', ')}` : '; this graph has none') +
    ". graph_query '.workspace.root=<directory>' finds the one at a directory"
}

/** The refusal for a call left to a default sandbox the host does not lend. */
export let unlent = async (g: Graph): Promise<Refused> =>
  new Refused(
    'This host lends no default sandbox provider, so name a workspace or a ' +
      `sandbox provider it configures. ${await naming(g)}`,
  )

/** Resolve an explicit target or the session default, never a local fallback. */
export let targetFor = async (
  g: Graph,
  session: string | undefined,
  args: Record<string, unknown>,
): Promise<Target> => {
  let home = session
    ? component((await g.get([session], ['home']))[0]?.home)
    : undefined
  let workspace = args.workspace ?? home?.workspace
  if (typeof workspace != 'string' || !workspace) {
    throw new Refused(
      `No workspace named, and the session has no home: ${await naming(g)}`,
    )
  }
  let row = (await g.get([workspace], ['workspace']))[0]
  let record = component(row?.workspace)
  if (!record) {
    throw new Refused(`Not a workspace: ${workspace}. ${await naming(g)}`)
  }
  let cwd = args.cwd ?? (args.workspace == null ? home?.cwd : undefined) ??
    record.root
  if (typeof cwd != 'string' || !cwd.startsWith('/') || cwd.includes('\0')) {
    throw new Refused('Workspace cwd must be an absolute path')
  }
  return { workspace, cwd }
}

/** A guarded default change. Omitting cwd explicitly clears the previous one. */
export let sessionHome = async (
  g: Graph,
  session: string,
  workspace: string,
  cwd?: string,
): Promise<Bundle[]> => {
  let row = (await g.get([session]))[0]
  if (!row?.session) throw new Error('Not a session: ' + session)
  let old = component(row.home)
  await targetFor(g, undefined, { workspace, ...cwd != null ? { cwd } : {} })
  return await g.apply([{
    entity: { eid: session },
    home: { workspace, cwd: cwd ?? null },
    $was: {
      home: {
        workspace: token(old?.workspace ?? null),
        cwd: token(old?.cwd ?? null),
      },
    },
  }])
}

/** Process operations ignore the caller's current home. */
export let processWorkspace = async (
  g: Graph,
  process: string,
): Promise<string> => {
  let row = (await g.get([process], ['process']))[0]
  let workspace = component(row?.process)?.workspace
  if (typeof workspace != 'string') {
    throw new Refused('Process launch workspace is unknown: ' + process)
  }
  return workspace
}

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
    throw new Refused('Select a workspace explicitly or set session home')
  }
  let row = (await g.get([workspace], ['workspace']))[0]
  let record = component(row?.workspace)
  if (!record) throw new Refused('Not a workspace: ' + workspace)
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

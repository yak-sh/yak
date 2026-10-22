import { Refused } from '@yaks/graph/errors'
// Session homes are convenience defaults over durable workspace identities.
// Sandbox intentions are recorded before provisioning; changing a default never
// disposes a resource or changes the target of a previously launched process.
import { CallError } from '@yaks/tools/errors'
import type { Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { type Machine, settle } from '@yaks/machine'
import { targetFor, unlent, type Workspaces } from '@yaks/machine/targets'
import type { ChildLimits } from '@yaks/session'
import { type Snapshot, snapshot } from '@yaks/context'
import { type As, owed } from '@yaks/persona'
import { isAbsolute, relative, resolve } from '@std/path/posix'
import type { Host } from '@yaks/host'

export let homeAt = (workspace?: string, cwd?: string): Comp => ({
  ...workspace ? { workspace } : {},
  ...cwd ? { cwd } : {},
})
export let sessionCwd = async (
  g: Graph,
  session: string,
  fallback?: string,
): Promise<string | undefined> => {
  let home = (await g.get([session], ['home']))[0]?.home as Comp | undefined
  return home?.cwd == null ? fallback : String(home.cwd)
}
export let owing = async (
  g: Graph,
  home: Comp,
  files: Snapshot[],
  context: As = {},
): Promise<Snapshot[]> => {
  if (!home.cwd && !context.persona && !context.work) return []
  let owes = await owed(
    g,
    String(home.cwd ?? ''),
    files.map((f) => f.body),
    context,
  )
  return owes ? [await snapshot(owes.text, owes.source)] : []
}
export type WorkspaceFile = { path: string; bytes: Uint8Array }
export let machines = (
  g: Graph,
  sandboxes?: Host['sandboxes'],
  resolveHome?: Host['resolveHome'],
  workspaces?: Workspaces,
): SessionMachines => {
  let home = async (session: string, supplied?: Comp): Promise<Comp> => {
    let owner = (await g.get([session], ['session', 'home']))[0]
    let at = supplied ?? owner?.home as Comp | undefined ?? {}
    if (at.workspace) return at
    let prepared = owner ? await resolveHome?.(session) : undefined
    if (prepared?.workspace) at = { ...at, ...prepared }
    else {
      if (!sandboxes) {
        throw await unlent(g)
      }
      at = {
        ...at,
        workspace: await sandboxes.request(
          derivedEid('session-sandbox|' + session),
        ),
      }
    }
    if (owner) await g.apply([{ entity: { eid: session }, home: at }])
    return at
  }
  let lent = async (session: string, supplied?: Comp) => {
    let at = await home(session, supplied)
    if (!workspaces) {
      throw new Refused('This host lends no workspace execution binding')
    }
    let target = await targetFor(g, undefined, at)
    let record = (await g.get([target.workspace], ['workspace']))[0]
      ?.workspace as Comp
    return {
      machine: await workspaces.connect(target.workspace),
      root: String(record.root),
      cwd: target.cwd,
    }
  }
  let limits: ChildLimits = {
    taskDefaults: async (parent) => {
      let at = (await g.get([parent], ['home']))[0]?.home as Comp | undefined
      let source = at?.workspace
        ? (await g.get([String(at.workspace)], ['sandbox']))[0]?.sandbox as
          | Comp
          | undefined
        : undefined
      return { sandbox: { ...source?.from ? { from: source.from } : {} } }
    },
    childProperties: {
      workspace: {
        type: 'string',
        description: 'Existing workspace; a default target, not permissions.',
      },
      sandbox: {
        type: 'object',
        description:
          'Request a separate sandbox. Omit to share the parent workspace.',
        properties: {
          provider: { type: 'string' },
          from: { type: 'string' },
          image: { type: 'string' },
        },
        additionalProperties: false,
      },
      cwd: {
        type: 'string',
        description:
          'Command directory in the target filesystem; relative to the parent directory.',
      },
    },
    prepareChild: async ({ parent, child, args }) => {
      if (args.machine != null) {
        throw new CallError(
          'workspace',
          'Use workspace or sandbox, not machine',
        )
      }
      if (args.workspace != null && args.sandbox != null) {
        throw new CallError(
          'workspace',
          'Select workspace or sandbox, not both',
        )
      }
      let inherited = args.workspace != null || args.sandbox != null
        ? (await g.get([parent], ['home']))[0]?.home as Comp | undefined ?? {}
        : await home(parent)
      let at: Comp
      if (args.sandbox != null) {
        if (typeof args.sandbox != 'object' || Array.isArray(args.sandbox)) {
          throw new CallError('sandbox', 'sandbox must be a request object')
        }
        if (!sandboxes) {
          throw await unlent(g)
        }
        at = {
          workspace: await sandboxes.request(
            derivedEid('session-sandbox|' + child),
            args.sandbox as {
              provider?: string
              from?: string
              image?: string
            },
          ),
        }
      } else if (args.workspace != null) {
        if (typeof args.workspace != 'string') {
          throw new CallError('workspace', 'workspace must be an entity id')
        }
        at = { workspace: args.workspace }
        await targetFor(g, undefined, at)
      } else at = { ...inherited }
      if (args.cwd != null) {
        if (
          typeof args.cwd != 'string' || !args.cwd || args.cwd.includes('\0')
        ) throw new CallError('cwd', 'cwd must be a nonempty path')
        let base = inherited.cwd as string | undefined
        if (!isAbsolute(args.cwd) && !base) {
          throw new CallError(
            'cwd',
            'Relative cwd requires a parent command directory',
          )
        }
        at.cwd = resolve(base ?? '/', args.cwd)
      }
      return { home: at }
    },
  }
  return {
    home,
    homeAt,
    limits,
    machine: async (session, supplied) =>
      (await lent(session, supplied)).machine,
    cwd: async (session) => (await lent(session)).cwd,
    // Resource disposal is explicit, never a consequence of transcript state.
    release: async () => {},
    files: async function* (session, paths) {
      let loan = await lent(session)
      for (let path of paths) {
        let target = resolve(loan.cwd, path)
        let scoped = relative(loan.root, target)
        if (
          !scoped || scoped == '..' || scoped.startsWith('../') ||
          isAbsolute(scoped)
        ) {
          throw new CallError(
            'path',
            'Workspace file is outside its export root: ' + path,
          )
        }
        let quote = (path: string) => "'" + path.replaceAll("'", "'\\''") + "'"
        // Resolve links on the target before reading, not on the graph host.
        let id = await loan.machine.start(
          `set -eu; root=$(cd -- ${
            quote(loan.root)
          } && pwd -P); file=$(realpath -e -- ${
            quote(target)
          }); if [ "$root" != / ]; then case "$file" in "$root"/*) ;; *) exit 1;; esac; fi; test -f "$file"; base64 -- "$file"`,
          loan.cwd,
        )
        let proc = await settle(loan.machine, id)
        if (!proc) throw new Error('Workspace export lost its process')
        if (proc.exit?.code != 0) {
          throw new Error(
            'Workspace export failed: ' +
              (await loan.machine.tail(id, 40)).join('\n'),
          )
        }
        let binary = atob(
          (await loan.machine.tail(id, Number.MAX_SAFE_INTEGER)).join(''),
        )
        yield {
          path: scoped,
          bytes: Uint8Array.from(binary, (c) => c.charCodeAt(0)),
        }
      }
    },
  }
}
export type SessionMachines = {
  home: (session: string, supplied?: Comp) => Promise<Comp>
  machine: (session: string, supplied?: Comp) => Promise<Machine>
  cwd: (session: string) => Promise<string | undefined>
  homeAt: typeof homeAt
  release: (session: string) => Promise<void>
  files: (session: string, paths: string[]) => AsyncIterable<WorkspaceFile>
  limits: ChildLimits
}

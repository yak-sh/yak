import { Refused } from '@yaks/graph/errors'
import { targetFor, type Workspaces } from '@yaks/machine/targets'
// Instruction admission reads only the explicitly named machine. The files
// become immutable prompt snapshots; later machine edits do not rewrite them.
import type { Comp, Graph } from '@yaks/graph'
import { type Snapshot, snapshot } from '@yaks/context'
import type { Machine } from '@yaks/machine'
import { owing } from './session_machines.ts'
import type { As } from '@yaks/persona'

/** Each directory from the root down to `dir`, an absolute path. */
let ancestors = (dir: string): string[] =>
  dir == '/'
    ? ['/']
    : [...ancestors(dir.slice(0, dir.lastIndexOf('/')) || '/'), dir]

/** Root-to-leaf AGENTS.md files on a machine, with canonical source paths:
 * the machine says what each candidate is, then its files are read. A link
 * to nothing is a projection gone missing, kept in `missing` where given. */
export let instructionFiles = async (
  machine: Machine,
  cwd: string,
  home?: string,
  missing?: string[],
): Promise<Snapshot[]> => {
  let [here] = await machine.stat([cwd])
  if (here.kind != 'directory') {
    throw new Error('Instruction discovery has no directory: ' + cwd)
  }
  let global = home && `${home.replace(/\/+$/, '')}/.agents/AGENTS.md`
  let paths = [
    ...global ? [global] : [],
    ...ancestors(here.canonical).map((d) => (d == '/' ? '' : d) + '/AGENTS.md'),
  ]
  let found = await machine.stat(paths)
  let lost = paths.filter((p, i) => found[i].kind == 'dangling' && p != global)
  if (lost.length && !missing) throw unavailable(lost)
  missing?.push(...lost)
  let files: Snapshot[] = []
  for (let [i, source] of paths.entries()) {
    let { kind } = found[i]
    if (kind == 'missing' || kind == 'dangling') continue
    if (kind != 'file') {
      throw new Error('Instruction file is not a regular file: ' + source)
    }
    files.push(await snapshot(await machine.read(source), source))
  }
  return files
}

let unavailable = (paths: string[]) =>
  new Refused(
    'Instruction projection is missing: ' + paths.join(', ') +
      '. Supply --persona or --work with the graph task or project.',
  )

let admitted = async (
  g: Graph,
  machine: Machine | undefined,
  home: Comp,
  context: As,
): Promise<Snapshot[]> => {
  let missing: string[] = []
  let files = machine && home.cwd
    ? await instructionFiles(machine, String(home.cwd), undefined, missing)
    : []
  let graph = await owing(g, home, files, context)
  if (
    missing.length && !graph.length &&
    !(await owing(g, home, [], context)).length
  ) throw unavailable(missing)
  return [...files, ...graph]
}

/** Opening a graph-only session does not acquire any machine. An explicit
 * ready workspace may be connected because instruction admission reads files. */
export let instructionsFor = async (
  g: Graph,
  home: Comp,
  workspaces?: Workspaces,
  context: As = {},
): Promise<Snapshot[]> => {
  if (home.workspace) {
    let [row] = await g.get([String(home.workspace)])
    if (row?.pending) return admitted(g, undefined, home, context)
    if (!workspaces) {
      throw new Refused('This host lends no workspace execution binding')
    }
    let target = await targetFor(g, undefined, home)
    home.cwd ??= target.cwd
    return admitted(
      g,
      await workspaces.connect(target.workspace),
      home,
      context,
    )
  }
  return admitted(g, undefined, home, context)
}

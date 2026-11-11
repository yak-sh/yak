import { Refused } from '@yaks/graph/errors'
import { targetFor, type Workspaces } from '@yaks/machine/targets'
// Instruction admission reads only the explicitly named machine. The files
// become immutable prompt snapshots; later machine edits do not rewrite them.
import type { Comp, Eid, Graph } from '@yaks/graph'
import { type Snapshot, snapshot } from '@yaks/context'
import type { Machine } from '@yaks/machine'
import { personaOf } from './worn.ts'
import { type As, offer, unsaid, wearing } from '@yaks/persona'
import { gather } from '@yaks/topic'

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

// The instruction files of the machine a home names, and the projections
// missing among them. A home naming no directory reads none.
let admitted = async (
  machine: Machine,
  home: Comp,
  missing: string[],
): Promise<Snapshot[]> =>
  home.cwd
    ? await instructionFiles(machine, String(home.cwd), undefined, missing)
    : []

/** The instruction files a session opening at `home` reads from its machine.
 * Opening a graph-only session does not acquire any machine. An explicit
 * ready workspace may be connected because instruction admission reads files.
 * A projection gone missing is kept in `missing` where given, and refused
 * where not. */
export let instructionsFor = async (
  g: Graph,
  home: Comp,
  workspaces?: Workspaces,
  missing?: string[],
): Promise<Snapshot[]> => {
  if (!home.workspace) return []
  let [row] = await g.get([String(home.workspace)])
  if (row?.pending) return []
  if (!workspaces) {
    throw new Refused('This host lends no workspace execution binding')
  }
  let target = await targetFor(g, undefined, home)
  home.cwd ??= target.cwd
  let lost: string[] = []
  let files = await admitted(
    await workspaces.connect(target.workspace),
    home,
    lost,
  )
  if (lost.length && !missing) throw unavailable(lost)
  missing?.push(...lost)
  return files
}

/** Who a session is and what it is opened on: its persona or work (@yaks/persona
 * `As`), the topic whose tree follows the persona's text on every ask, and the
 * session that started it, whose persona it wears where nothing else gives
 * one. */
export type On = As & { topic?: string; starter?: Eid }

// Who a session wears where nothing chose it a persona and neither its work
// nor its checkout carries one: the persona of the session that started it
// (./worn.ts `personaOf`), as a helper works as its starter does.
let starting = async (g: Graph, home: Comp, context: On): Promise<On> => {
  if (context.persona || !context.starter) return context
  if (await wearing(g, String(home.cwd ?? ''), context)) return context
  let persona = await personaOf(g, context.starter)
  return persona ? { ...context, persona } : context
}

/** What a session opening here begins with: the instruction files of its
 * machine, the persona it wears (@yaks/persona `wearing`, else its starter's)
 * and the names of the tools that persona offers (@yaks/persona `offer`),
 * which are then all a turn is offered. No `tools` where that persona offers
 * none, which leaves the runner's own set.
 *
 * The persona's text and the topic's tree are not among the files: the runner
 * says both afresh on every ask (./worn.ts `wornBy`), so a file that only
 * projects the persona is left out too (@yaks/persona `unsaid`). A topic that
 * is not there is refused, as a persona is, and so is a projection gone
 * missing where nothing is worn. */
export let openingFor = async (
  g: Graph,
  home: Comp,
  workspaces?: Workspaces,
  context: On = {},
): Promise<{ files: Snapshot[]; persona?: Eid; tools?: string[] }> => {
  let as = await starting(g, home, context)
  if (as.topic && !await gather(g)(as.topic)) {
    throw new Refused(`no topic called ${as.topic}`)
  }
  let missing: string[] = []
  let files = await instructionsFor(g, home, workspaces, missing)
  let cwd = String(home.cwd ?? '')
  let worn = await wearing(g, cwd, as)
  if (missing.length && !worn) throw unavailable(missing)
  if (worn && files.length) {
    let kept = await unsaid(g, cwd, files.map((f) => f.body), as)
    files = files.filter((f) => kept.includes(f.body))
  }
  let tools = offer(worn)
  return {
    files,
    ...worn ? { persona: worn.persona.entity.eid } : {},
    ...tools ? { tools } : {},
  }
}

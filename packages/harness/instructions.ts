import { Refused } from '@yaks/graph/errors'
import { targetFor, type Workspaces } from '@yaks/machine/targets'
// Instruction admission reads only the explicitly named machine. The files
// become immutable prompt snapshots; later machine edits do not rewrite them.
import type { Comp, Graph } from '@yaks/graph'
import { type Snapshot, snapshot } from '@yaks/context'
import type { Machine } from '@yaks/machine'
import { type Machines, owing } from './session_machines.ts'
import type { As } from '@yaks/persona'

let quoted = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'"

/** Root-to-leaf AGENTS.md files on a machine, with canonical source paths. */
export let instructionFiles = async (
  machine: Machine,
  cwd: string,
  home?: string,
  missing?: string[],
): Promise<Snapshot[]> => {
  let id = await machine.start(
    `set -e; cd -- ${
      quoted(cwd)
    }; directory=$(pwd -P); while :; do path="$directory/AGENTS.md"; if [ -L "$path" ] && [ ! -e "$path" ]; then printf '!%s\\n' "$path"; elif [ -e "$path" ]; then [ -f "$path" ] && [ -r "$path" ]; printf '%s\\n' "$path"; fi; [ "$directory" = / ] && break; directory=$(dirname -- "$directory"); done`,
    cwd,
  )
  for (;;) {
    let process = await machine.look(id)
    if (!process) throw new Error('Instruction discovery lost its process')
    if (process.exit) {
      if (process.exit.code != 0) {
        throw new Error(
          `Instruction discovery exited ${process.exit.code}: ` +
            (await machine.tail(id, 40)).join('\n'),
        )
      }
      break
    }
    await new Promise((go) => setTimeout(go, machine.poll ?? 100))
  }
  let paths = (await machine.tail(id, 10000)).filter(Boolean).reverse()
  if (home) {
    let source = `${home.replace(/\/+$/, '')}/.agents/AGENTS.md`
    let found = await machine.start(
      `if [ -e ${quoted(source)} ]; then [ -f ${quoted(source)} ] && [ -r ${
        quoted(source)
      } ] && printf '%s\\n' ${quoted(source)}; fi`,
      cwd,
    )
    for (;;) {
      let p = await machine.look(found)
      if (!p) throw new Error('Instruction discovery lost its process')
      if (p.exit) {
        if (p.exit.code != 0) {
          throw new Error('Global instruction file is unavailable')
        }
        paths.unshift(...(await machine.tail(found, 1)).filter(Boolean))
        break
      }
      await new Promise((go) => setTimeout(go, machine.poll ?? 100))
    }
  }
  let lost = paths.filter((p) => p.startsWith('!')).map((p) => p.slice(1))
  if (lost.length && !missing) throw unavailable(lost)
  missing?.push(...lost)
  let files: Snapshot[] = []
  for (let source of paths.filter((p) => !p.startsWith('!'))) {
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
 * machine may be woken or requested because instruction admission reads files. */
export let instructionsFor = async (
  g: Graph,
  configured: Machines | undefined,
  home: Comp,
  workspaces?: Workspaces,
  context: As = {},
): Promise<Snapshot[]> => {
  if (home.workspace) {
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
  if (!home.machine) return admitted(g, undefined, home, context)
  let id = String(home.machine)
  let [row] = await g.get([id])
  let record = row?.machine as Comp | undefined
  if (!record) throw new Error('not a machine entity: ' + id)
  let provider = await configured?.provider(String(record.provider))
  if (!provider) {
    throw new Error('Machine provider is not configured: ' + record.provider)
  }
  let ref = {
    id,
    ...record.address != null ? { address: String(record.address) } : {},
  }
  let loan = record.state == 'requested' || record.state == 'released'
    ? ref.address != null
      ? await provider.attach?.({ ...ref, address: ref.address })
      : await provider.request?.({
        id,
        ...record.from != null ? { from: String(record.from) } : {},
        ...record.image != null ? { image: String(record.image) } : {},
      })
    : await provider.wake(ref)
  if (!loan) throw new Error('Provider cannot lend machine: ' + id)
  if (record.state != 'running') {
    await g.apply([{ entity: { eid: id }, machine: { state: 'running' } }])
  }
  let cwd = home.cwd == null ? loan.cwd : String(home.cwd)
  home.cwd ??= cwd
  return admitted(g, loan.machine, home, context)
}

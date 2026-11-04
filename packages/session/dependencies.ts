// Find work a resting transcript can do instead of waiting for an unattended
// dependency. Decisions, explicit outside blockers and a person's queue remain
// external waits; an agent's queue is work the transcript can take.
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { dependencies, settled, statusOf } from '@yaks/task'
import { currentStatus } from './react.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

export type Work = {
  tasks: Bundle[]
  claims: Bundle[]
  problems: string[]
  resume: Map<Eid, Bundle[]>
  release: Eid[]
}

let external = async (g: Graph, row: Bundle) => {
  if (row.decision || row.blocked) return true
  let assignee = comp(row, 'filed')?.assignee
  return !!assignee && !!g.vocab.comp('person') &&
    !!(await g.get([String(assignee)], ['person']))[0]?.person
}

/** Follow unfinished dependencies to their runnable leaves. Other active
 * workers keep their work; missing or terminal holders can be replaced. */
export let unattended = async (
  g: Graph,
  session: Eid,
  roots: Bundle[],
): Promise<Work> => {
  let found: Work = {
    tasks: [],
    claims: [],
    problems: [],
    resume: new Map(),
    release: [],
  }
  let seen = new Set<Eid>()
  let visit = async (eid: Eid, path: Eid[]): Promise<void> => {
    if (path.includes(eid)) {
      found.problems.push(`Dependency cycle: ${[...path, eid].join(' -> ')}`)
      return
    }
    if (seen.has(eid)) return
    seen.add(eid)
    let [row] = await g.get([eid])
    if (!row?.task) {
      found.problems.push(`Dependency ${eid} is missing or is not a task`)
      return
    }
    if (settled(statusOf(g.vocab, row)) || await external(g, row)) return
    let holder = comp(row, 'claim')?.session
    let [owner] = holder && holder != session
      ? await g.get([String(holder)], ['session', 'process', 'exit', 'stop'])
      : []
    // Wrapping a managed run marks the session ended before its process exits.
    // Its process remains the authority, including while it is winding down.
    if (owner?.session && owner.process && !owner.exit) return
    let ended = !owner?.process && comp(owner, 'session')?.ended === true ||
      !!owner?.stop
    let status = owner?.session && !owner.process
      ? await currentStatus(g, String(holder))
      : undefined
    let abandoned = !owner?.session || ended ||
      status == 'failed' || status == 'stopped' ||
      !!owner?.exit && comp(owner, 'exit')?.code !== 0
    if (holder && holder != session && abandoned) {
      // Claim release owns this transition. Never overwrite another holder,
      // including one whose terminal entry has not been reconciled yet.
      found.release.push(eid)
      return
    }
    if (holder && holder != session && !abandoned) {
      // A running/queued worker owns its whole dependency chain. A resting
      // worker's leaves are inspected too, so nested parking cannot hide work.
      if (owner?.process ? !owner.exit : status != 'settled') return
    }
    let kids = await dependencies(g, eid)
    let open = []
    for (let kid of kids) {
      let [child] = await g.get([kid])
      if (!child || !settled(statusOf(g.vocab, child))) open.push(kid)
    }
    if (open.length) {
      for (let kid of open) await visit(kid, [...path, eid])
      return
    }
    if (holder && holder != session && !abandoned) {
      let tasks = found.resume.get(String(holder)) ?? []
      tasks.push(row)
      found.resume.set(String(holder), tasks)
      return
    }
    found.tasks.push(row)
    found.claims.push({
      entity: row.entity,
      claim: { session },
      $was: { claim: { session: token(holder) } },
    })
  }
  for (let root of roots) {
    for (let dep of await dependencies(g, root.entity.eid)) {
      await visit(dep, [root.entity.eid])
    }
  }
  return found
}

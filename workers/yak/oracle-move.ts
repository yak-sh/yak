// Legacy oracle projections have no recoverable reader. Keep their words,
// quarantined, and let each reader obtain fresh sources through their reach.
// A project is its own topic, but it is the space's home in its Operator's
// store, which every task and decision there is filed under, so it is never
// quarantined: what a legacy oracle learned on it moves to a row of its own.
import { line } from '@yaks/query'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { Meta } from '@yaks/sqlite'

export let ORACLES = 'operator:oracles'
/** Where a store says the projects the first pass quarantined are restored. */
export let PROJECTS = 'operator:oracle-projects'
export let BATCH = 50

type Store = {
  g: Graph
  marks?: Pick<Meta, 'get' | 'set'>
  waiting?: () => number
}

let quarantine = (eid: string, subject: string): Bundle => ({
  entity: { eid },
  operator_oracle: { person: null, subject },
})

// What a legacy oracle learned on a project, quarantined on a row of its own,
// and the project itself no oracle's, so it has no owner and every reader of
// the store sees it.
let learned = (project: Bundle): Bundle[] => {
  let subject = project.entity.eid
  return [
    {
      entity: { eid: subject },
      operator_oracle: null,
      ...project.content ? { content: null } : {},
    },
    ...project.content
      ? [{
        ...quarantine(
          derivedEid(`operator-oracle|learned|${subject}`),
          subject,
        ),
        content: project.content,
      }]
      : [],
  ]
}

/** One bounded metadata-only batch. Bodies and learned contents stay intact. */
export let oracleBackfill = async (
  { g, marks, waiting }: Store,
): Promise<boolean> => {
  if (!marks || marks.get(ORACLES) == 'done') return false
  if (waiting?.()) return true
  let topics = await g.read(
    line`.topic&!operator_oracle&!project&.limit=${BATCH}&.fields=entity.eid`,
  )
  let writes: Bundle[] = []
  for (let topic of topics) {
    let subject = topic.entity.eid
    writes.push(quarantine(subject, subject))
    let sources = await g.get(
      ['memories', 'app'].map((key) =>
        derivedEid(`operator-oracle|${key}|${subject}`)
      ),
      ['operator_oracle'],
    )
    writes.push(
      ...sources.filter((b) => !b.operator_oracle).map((b) =>
        quarantine(b.entity.eid, subject)
      ),
    )
  }
  let edges = await g.read(
    line`.contains&!operator_oracle&(.edge.from.topic|.edge.to.topic)&.limit=${BATCH}&.fields=entity.eid,edge.from`,
  )
  writes.push(
    ...edges.map((b) =>
      quarantine(b.entity.eid, String((b.edge as Comp).from))
    ),
  )
  if (writes.length) await g.apply(writes, { trusted: true, stamp: false })
  if (topics.length == BATCH || edges.length == BATCH) return true
  marks.set(ORACLES, 'done')
  return false
}

/** One batch restoring the projects {@link oracleBackfill} quarantined before
 * it knew a project from an oracle. */
export let projectRepair = async (
  { g, marks, waiting }: Store,
): Promise<boolean> => {
  if (!marks || marks.get(PROJECTS) == 'done') return false
  if (waiting?.()) return true
  let projects = await g.read(
    line`.project&.operator_oracle.subject&!operator_oracle.person&.limit=${BATCH}&.fields=entity.eid,project,content,operator_oracle`,
  )
  let writes = projects.filter((b) =>
    (b.operator_oracle as Comp).subject == b.entity.eid
  ).flatMap(learned)
  if (writes.length) await g.apply(writes, { trusted: true, stamp: false })
  if (projects.length == BATCH) return true
  marks.set(PROJECTS, 'done')
  return false
}

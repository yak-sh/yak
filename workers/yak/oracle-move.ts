// Legacy oracle projections have no recoverable reader. Keep their words,
// quarantined, and let each reader obtain fresh sources through their reach.
import { line } from '@yaks/query'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { Meta } from '@yaks/sqlite'

export let ORACLES = 'operator:oracles'
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

/** One bounded metadata-only batch. Bodies and learned contents stay intact. */
export let oracleBackfill = async (
  { g, marks, waiting }: Store,
): Promise<boolean> => {
  if (!marks || marks.get(ORACLES) == 'done') return false
  if (waiting?.()) return true
  let topics = await g.read(
    line`.topic&!operator_oracle&.limit=${BATCH}&.fields=entity.eid`,
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

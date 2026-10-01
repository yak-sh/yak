// Delivery of the session bus. A native transcript gets an input in the same
// change that marks the item said; a caller using a tool sees owed lines in
// that tool's reply. The listener for an outside harness uses listen.ts.

import {
  type Bundle,
  type Comp,
  derivedEid,
  type Eid,
  type Graph,
  who,
} from '@yaks/graph'
import { absent, and, type Clause, every, present } from '@yaks/query'
import { deliver, pending } from './listen.ts'
import { statusOf } from './status.ts'

let comp = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp

// Find pending items first. Most sessions have no bus work, so a timer never
// needs to scan their transcripts.
let candidates = async (g: Graph): Promise<Eid[]> => {
  let unsaid = (...clauses: Clause[]) =>
    and(...clauses, absent('notified'), every())
  let queries = [
    ...g.vocab.comp('comment')
      ? [unsaid(present('comment'), present('comment.target.claim.session'))]
      : [],
    ...g.vocab.comp('knock')
      ? [
        unsaid(
          present('knock'),
          present('knock.target.session'),
        ),
        unsaid(present('knock'), present('knock.target.claim.session')),
      ]
      : [],
    ...g.vocab.comp('deliver')
      ? [unsaid(
        present('deliver'),
        present('deliver.to.session'),
      )]
      : [],
  ]
  let items = (await Promise.all(queries.map((q) => g.read(q)))).flat()
  let targets = [
    ...new Set(
      items.map((b) =>
        comp(b, 'comment').target ?? comp(b, 'knock').target ??
          comp(b, 'deliver').to
      ).filter((id): id is Eid => typeof id == 'string'),
    ),
  ]
  let rows = await g.get(targets)
  return [
    ...new Set(rows.flatMap((b) => [
      ...b.session ? [b.entity.eid] : [],
      ...typeof comp(b, 'claim').session == 'string'
        ? [String(comp(b, 'claim').session)]
        : [],
    ])),
  ]
}

// Indexed, bounded reads distinguish a native transcript from an outside
// session without loading its transcript on every tool reply.
let native = async (g: Graph, session: Bundle): Promise<boolean> => {
  if (!session.session || session.process) return false
  let id = session.entity.eid
  let [using, last] = await Promise.all([
    g.read(`.entry.session=${id}&.using&.limit=1`),
    g.read(`.entry.session=${id}&.order=-entry.seq&.limit=3&*`),
  ])
  return using.length > 0 &&
    !['stopped', 'failed'].includes(statusOf(last))
}

/** One pass over native sessions. A failed append leaves the item unmarked, so
 * the next pass can retry it. `attention` wakes the effects role's runner. */
export let feed = async (g: Graph): Promise<number> => {
  if (!g.vocab.comp('notified')) return 0
  let count = 0
  for (let id of await candidates(g)) {
    let [session] = await g.get([id])
    if (!session || !await native(g, session)) continue
    for (let { item, line } of await pending(g, id)) {
      let entry: Bundle = {
        entity: { eid: derivedEid(`session bus ${id} ${item.entity.eid}`) },
        entry: { session: id },
        content: { body: line },
        attention: {},
      }
      if (await deliver(g, null, item, entry)) count++
    }
  }
  return count
}

/** Lines owed to an outside caller, appended to a direct tool reply. */
export let reply = async (g: Graph, call: Bundle): Promise<Bundle[]> => {
  if (!g.vocab.comp('notified')) return []
  let id = who(call)?.via
  if (!id) return []
  let [session] = await g.get([id])
  if (!session?.session || await native(g, session)) return []
  let out: Bundle[] = []
  for (let { item, line } of await pending(g, id)) {
    if (!await deliver(g, null, item)) continue
    out.push({
      entity: {
        eid: derivedEid(`session reply ${call.entity.eid} ${item.entity.eid}`),
      },
      content: { body: line },
    })
  }
  return out
}

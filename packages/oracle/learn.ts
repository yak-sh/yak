// An oracle cultivates three contexts on its topic. Each direction points to
// immutable text and evidence citations; ordinary graph preconditions prevent
// one conversation from overwriting learning it has not read.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { argsOf, who } from '@yaks/graph/call'
import { token } from '@yaks/graph/guard'
import { derivedEid } from '@yaks/graph/identity'
import { Refused } from '@yaks/graph/errors'
import type { Runs } from '@yaks/graph/tools'
import { link } from '@yaks/edge'
import { content } from '@yaks/kernel'
import { sha256 } from '@yaks/graph/sha256'

export let directions = ['parent', 'self', 'children']
export let part = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let topic = async (g: Graph, eid: string) => {
  let [row] = await g.get([eid])
  if (!row?.topic || row.tombstone) {
    throw new Refused('Choose an existing topic')
  }
  return row
}
let read = async (g: Graph, eid: string): Promise<Bundle[]> => {
  let row = await topic(g, eid), kept = part(row, 'topic_context')
  return [
    {
      ...row,
      $was: {
        topic_context: Object.fromEntries(
          directions.map((slot) => [slot, token(kept[slot])]),
        ),
      },
    },
    ...await g.get(
      directions.flatMap((slot) => kept[slot] ? [String(kept[slot])] : []),
    ),
  ]
}
let revision = async (g: Graph, eid: string, slot: string, value: unknown) => {
  let input: Comp = value && typeof value == 'object' ? value as Comp : {}
  let body = typeof input.body == 'string' ? input.body : ''
  if (!body.trim()) {
    throw new Refused(`Give the ${slot} context its learned body`)
  }
  let ids = Array.isArray(input.evidence)
    ? [...new Set(input.evidence.map(String))]
    : []
  if (!ids.length) throw new Refused('Learning needs recorded evidence')
  let sources = await g.get(ids)
  if (sources.length != ids.length || sources.some((b) => b.tombstone)) {
    throw new Refused('Read and record every evidence source first')
  }
  let hashes = sources.map((b) => [b.entity.eid, content(g.vocab)(b)])
  let revision = sha256(body)
  let head = derivedEid(
    `topic context|${eid}|${slot}|${revision}|${JSON.stringify(hashes)}`,
  )
  let rows: Bundle[] = [
    {
      entity: { eid: head },
      prompt: { source: eid, scope: 'shared', revision },
      content: { body },
    },
    ...sources.map((source) => ({
      ...link(head, 'cites', source.entity.eid),
      cites: { hash: content(g.vocab)(source) },
    })),
  ]
  return { head, rows }
}

export let learning = (): Runs => ({
  oracle_read: (call, g) => read(g, String(argsOf(call).oracle)),
  oracle_revise: async (call, g) => {
    let args = argsOf(call), row = await topic(g, String(args.oracle))
    let slots = directions.filter((slot) => Object.hasOwn(args, slot))
    let was = args.was && typeof args.was == 'object' ? args.was as Comp : {}
    if (!slots.length || slots.some((slot) => !Object.hasOwn(was, slot))) {
      throw new Refused(
        'Read first, then revise directions with their preconditions',
      )
    }
    let rows: Bundle[] = [], context: Comp = {}
    for (let slot of slots) {
      let next = await revision(g, row.entity.eid, slot, args[slot])
      context[slot] = next.head
      rows.push(...next.rows)
    }
    rows.push({
      entity: row.entity,
      topic_context: context,
      $was: {
        topic_context: Object.fromEntries(
          slots.map((
            slot,
          ) => [slot, was[slot] == null ? null : String(was[slot])]),
        ),
      },
    })
    let actor = who(call)
    await g.apply(
      rows.map((b) => ({ ...b, ...actor ? { $actor: actor } : {} })),
    )
    return await read(g, row.entity.eid)
  },
})

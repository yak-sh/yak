// Connector reads of Operator files expose their metadata alone. The graph
// they query contains no conversations, even when a query walks references.
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { core } from '@yaks/mcp'
import type { Held } from './build-door.ts'
import {
  and,
  eq,
  or,
  parse,
  type Pred,
  present,
  stringify,
} from '@yaks/query/core'
import { type OperatorStore, operatorVocab } from './operator-store.ts'

/** Apply the caller's query to only the attachment metadata they own. */
export let attachmentQuery = async (
  store: OperatorStore,
  held: Held,
  q: string,
  call: string = crypto.randomUUID(),
): Promise<Bundle[]> => {
  let tree = parse(q)
  let focus = tree.clauses.find((clause): clause is Pred =>
    clause.kind == 'pred' && clause.op == '=' &&
    ['entity.eid', 'attachment.artifact'].includes(clause.path.join('.')) &&
    !!clause.value && ['scalar', 'list'].includes(clause.value.kind)
  )
  let by = [
    'operator_request',
    'entry.session.operator_session',
    'operator_session',
  ]
    .map((path) =>
      and(
        eq(`attachment.message.${path}.person`, held.person),
        eq(`attachment.message.${path}.space`, held.space),
      )
    )
  let narrowed = focus?.path.join('.') == 'entity.eid'
    ? or(focus, { ...focus, path: ['attachment', 'artifact'] })
    : focus
  let attachments = await store.g.read(stringify(and(
    present('attachment'),
    or(...by),
    ...(narrowed ? [narrowed] : []),
  )))
  let rows = attachments.map((row) => ({
    entity: row.entity,
    attachment: row.attachment,
  })) as Bundle[]
  let artifacts = await store.g.get([
    ...new Set(
      rows.map((row) =>
        String((row.attachment as { artifact: string }).artifact)
      ),
    ),
  ])
  let subset = graph({ vocab: operatorVocab, storage: ram(operatorVocab) })
  await subset.apply([
    ...rows,
    ...artifacts.filter((row) => row.artifact).map((row) => ({
      entity: row.entity,
      artifact: row.artifact,
    })),
  ], { trusted: true, stamp: false })
  let query = core({ vocab: operatorVocab }).find((tool) =>
    tool.name == 'graph_query'
  )!
  return await query.run(
    { entity: { eid: call }, call: { args: { q } } },
    subset,
  )
}

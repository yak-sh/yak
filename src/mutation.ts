// The graph mutation wire: ordinary component patches plus the small registry
// of database-owned operations whose read and guarded write must stay in one
// synchronous authority boundary. This transport union does not belong in the
// generated component vocabulary.
import type { Change, Edge } from './types.ts'

// A write literal is the read shape (D-23827): `entity: {eid}` names an
// existing entity, or — as a `$alias`, or as an eid a client minted itself (a
// uuid or a content hash) that names nothing yet — one this batch mints
// alongside the components it carries; components ride
// flat beside it exactly as a read shows them; edges are `dependency`
// sentences, a list when there are several. Wherever an eid goes — entity.eid,
// a ref column, a dependency child — a `$alias`, a human id, or a nested
// bundle stands in. `was` guards per column beside the components. A read's
// projections (kind, num, refs, backrefs, comments, derived and stamped
// columns) are ignored, so a read edits and goes straight back. `tombstone` is
// death: it lowers to the flat entity-null change and, since a dead entity
// takes no patch, stands alone beside `entity`. The older key/id/comps/deps
// literal is still accepted through the same door.
export type LiteralRef = string | number | EntityLiteral
export type DependencyLiteral = { type: Edge; child: LiteralRef }
export type EntityLiteral = {
  entity?: { eid?: string; num?: number }
  tombstone?: Record<string, never>
  dependency?: DependencyLiteral | DependencyLiteral[]
  was?: Record<string, Record<string, string | null>>
  key?: string
  id?: string
  comps?: Record<string, Record<string, unknown> | null>
  deps?: Partial<Record<Edge, LiteralRef | LiteralRef[]>>
  [comp: string]: unknown
}

export type LiteralMutation = { entities: EntityLiteral[] }
export type UndoMutation = {
  mutation: 'undo'
  id?: number
  eid?: string
}
// The high-level worker take. The writer resolves both addresses and owns the
// session reification, optional approval, readiness read, and claim write in
// one transaction. Raw Change[] remains the administrative graph door.
export type WorkClaimMutation = {
  mutation: 'claim_work'
  target: string
  session: string
  mode: 'ready' | 'approve'
  recursive?: boolean
  cwd?: string
}
export type FlatMutation = Change[] | UndoMutation | WorkClaimMutation
export type Mutation = FlatMutation | LiteralMutation

export type MutationResult = {
  changes: Change[]
  aliases: Record<string, string>
}

export type MutationOutput<T extends Mutation = Mutation> = T extends
  LiteralMutation ? MutationResult : Change[]

// In-process and headless public APIs preserve their flat Change[] result.
// Transport-neutral tool IO needs one shape, so it lifts that legacy result at
// the boundary rather than forcing every established caller to change.
export let mutationResult = (
  output: Change[] | MutationResult,
): MutationResult =>
  Array.isArray(output) ? { changes: output, aliases: {} } : output

// The graph mutation wire: ordinary component patches plus the small registry
// of database-owned operations whose read and guarded write must stay in one
// synchronous authority boundary. This transport union does not belong in the
// generated component vocabulary.
import type { Change, Edge } from './types.ts'

export type LiteralRef = string | number | EntityLiteral
export type EntityLiteral = {
  key?: string
  id?: string
  comps?: Record<string, Record<string, unknown> | null>
  deps?: Partial<Record<Edge, LiteralRef | LiteralRef[]>>
  was?: Record<string, Record<string, string | null>>
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

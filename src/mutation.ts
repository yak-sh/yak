// The graph mutation wire: ordinary component patches plus the small registry
// of database-owned operations whose read and guarded write must stay in one
// synchronous authority boundary. This transport union does not belong in the
// generated component vocabulary.
import type { Change } from './types.ts'

export type Mutation = Change[] | {
  mutation: 'undo'
  id?: number
  eid?: string
}

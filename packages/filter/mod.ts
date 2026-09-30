/**
 * @yaks/filter: the query field, a domain component giving completion wherever
 * a query is typed, in a browser and in a terminal. Its state is the `filter`
 * component (vocab.json), one entity per field in the host's front-end graph,
 * and what is typed in it is the person's draft (the host's `drafts`); its
 * actions (type, set, move, accept, dismiss, press) are patches to them; it
 * is built of @yaks/ui's `Field` and `Choices`, and completes through
 * @yaks/query's `complete`.
 *
 * - `filters(front, {vocab, drafts, source, Float})`: the field bound to its
 *   host (filters.ts).
 * - `typed`, `placed`, `moved`, `taken`, `dismissed`, `act`: what each action
 *   makes of a row, pure (state.ts).
 *
 * @module
 */

export {
  type Anchor,
  type Drafts,
  type FilterProps,
  type Filters,
  filters,
  type Float,
  type Front,
  type Opts,
} from './filters.ts'
export {
  type Act,
  act,
  CAP,
  dismissed,
  moved,
  placed,
  type Row,
  taken,
  typed,
} from './state.ts'

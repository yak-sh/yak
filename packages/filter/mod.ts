/**
 * @yaks/filter: the query field, a domain component giving completion wherever
 * a query is typed, in a browser and in a terminal. Its state is the `filter`
 * and `completion` components (vocab.json), one entity per field in the host's
 * front-end graph; its actions (type, set, move, accept, dismiss, press) are
 * patches to them; it
 * is built of @yaks/ui's `Field` and `Choices`, and completes through
 * @yaks/query's `complete`.
 *
 * - `filters(front, {vocab, source, Float})`: the field bound to its host
 *   (filters.ts).
 * - `typed`, `placed`, `moved`, `taken`, `dismissed`, `act`: what each action
 *   makes of a row, pure (state.ts); `rowOf` and `put` read a row off its
 *   entity and write one back.
 *
 * @module
 */

export {
  type Anchor,
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
  put,
  type Row,
  rowOf,
  taken,
  typed,
} from './state.ts'

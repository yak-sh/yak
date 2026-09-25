// The connection this adapter runs on is @yaks/sql's `Driver`: a statement in,
// rows out. It is data-last config passed to `storage()`; the adapter never
// constructs one (./db.ts `open()` is the door to an embedded one).
//
// TODO(T-39499): re-exported while the packages that import it from here move
// to @yaks/sql.

export { type Driver, effect, type Row } from '@yaks/sql'
export type { Param } from '@yaks/sql'

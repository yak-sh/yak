// Query binding and compilation over the shared SQL data and driver interface.
import type { Raw } from './ast.ts'
import type { Row } from './driver.ts'

export * from './core.ts'
export * from './derived.ts'
export * from './extend.ts'
export { walk } from './walk.ts'
export { absentDerived } from './absent.ts'
export {
  bind,
  type BindOpts,
  type Census,
  crowded,
  type Numbered,
  screen,
  tallied,
  visibleBacked,
  visibleDerived,
  walks,
} from './bind.ts'

/** A compiled statement: its SQL and the parameters it binds, in order. */
export type Compiled = Raw & {
  /** Rows proved by the query's inputs alone; no engine read is needed. */
  answer?: Row[]
}

export { compile, sourceScreen } from './kept.ts'

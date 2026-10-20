// Query binding and compilation over the shared SQL data and driver interface.
import type { Raw } from './ast.ts'

export * from './core.ts'
export * from './derived.ts'
export * from './extend.ts'
export { walk } from './walk.ts'
export {
  bind,
  type BindOpts,
  screen,
  sourceScreen,
  tallied,
  visibleDerived,
} from './bind.ts'

/** A compiled statement: its SQL and the parameters it binds, in order. */
export type Compiled = Raw

export { compile } from './kept.ts'

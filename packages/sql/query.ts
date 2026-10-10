// Query binding and compilation over the shared SQL data and driver interface.
import type { And } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { bind, type BindOpts } from './bind.ts'
import type { Raw } from './ast.ts'
import { render } from './render.ts'

export * from './core.ts'
export * from './derived.ts'
export * from './extend.ts'
export { walk } from './walk.ts'
export { bind, type BindOpts, screen, tallied } from './bind.ts'

/** A compiled statement: its SQL and the parameters it binds, in order. */
export type Compiled = Raw

// Compile an AST against a vocabulary into SQL plus parameters.
// `opts.derived` supplies computed-property expressions, `opts.extend`
// registers other packages' clause compilers, and `opts.now` fixes the moment a
// relative time phrase resolves against. Throws `Unsupported` for a clause
// outside the common path that no extension claims.
export let compile = (
  ast: And,
  vocab: Vocab,
  opts: BindOpts = {},
): Compiled => render(bind(ast, vocab, opts))

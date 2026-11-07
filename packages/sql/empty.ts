// Reference operands already resolved to no target cannot select an owner,
// and nor can a value of a component no entity wears yet (`opts.absent`, a
// table no write has raised). Prove that before building the scoped relations
// a selector will never read.
import type { And, Clause } from '@yaks/query/core'
import type { Vocab } from '@yaks/vocab'
import type { BindOpts } from './bind.ts'
import { literals } from './ident.ts'
import { as, lit, type Select, select, table } from './ast.ts'

let vacant = select({
  cols: [as(lit(null), 'eid')],
  from: table('entity'),
  where: lit(false),
})

export let empty = (
  query: And,
  vocab: Vocab,
  opts: BindOpts,
): Select | undefined => {
  // An extension may replace the built-in predicate (./extend.ts).
  if (opts.extend?.some((e) => e.compile.pred)) return undefined
  let absent = new Set(opts.absent)
  if (!opts.references && !absent.size) return undefined
  let visit = (c: Clause): boolean | undefined => {
    if (c.kind == 'and' || c.kind == 'or') {
      let arms = c.clauses.map(visit)
      if (!arms.length || arms.some((a) => a === undefined)) return undefined
      return c.kind == 'and' ? arms.some(Boolean) : arms.every(Boolean)
    }
    if (
      c.kind != 'pred' || c.not || c.where || c.op != '=' ||
      c.path.length != 2
    ) return undefined
    let [comp, prop] = c.path, p = vocab.prop(comp, prop)
    if (
      !p || p.computed || vocab.comp(comp)?.computed ||
      opts.derived?.[`${comp}.${prop}`]
    ) return undefined
    let ids = literals(c.value)
    if (!ids?.length) return undefined
    if (absent.has(comp)) return true
    if (
      !opts.references || p.category != 'ref' || vocab.comp(p.ref!)?.computed
    ) return undefined
    return ids.every((id) => opts.references![id] === null)
  }
  return visit(query) === true ? vacant : undefined
}

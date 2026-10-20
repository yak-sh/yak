// Work discovery asks for eligibility before taking a bounded page. Relative
// time stays in the query; each pass supplies its clock at the read boundary.
import { absent, type And, and, eq, le, list, ne, or, time } from '@yaks/query'

let due = or(absent('effect.next'), le('effect.next', time('now')))
let free = or(
  absent('effect.lease_owner'),
  absent('effect.lease_expiry'),
  le('effect.lease_expiry', time('now')),
)

export let ready = (
  handlers: string[],
  opts: { singleOwner?: boolean; disabled?: string[]; owner?: string } = {},
): And => {
  let enabled = handlers.filter((name) => !opts.disabled?.includes(name))
  let disabled = handlers.filter((name) => opts.disabled?.includes(name))
  let claims = opts.singleOwner ? [] : [free]
  // A replacement owes its own startup. A peer taking that row would run its
  // own closure instead, then lose the duty when the peer shuts down. Not
  // equals holds where there is no kind, so absence needs no arm of its own;
  // each arm of this disjunction is another seek per pass.
  let owner = opts.singleOwner || !opts.owner ? [] : [or(
    ne('effect.kind', 'started'),
    eq('effect.target', opts.owner),
  )]
  let active = enabled.length
    ? [and(eq('effect.handler', list(...enabled)), due, ...claims, ...owner)]
    : []
  let obsolete = disabled.length
    ? [
      and(
        eq('effect.handler', list(...disabled)),
        absent('effect.lease_owner'),
      ),
    ]
    : []
  let branches = [...active, ...obsolete]
  return and(
    eq('effect.state', 'pending'),
    ...branches.length == 1 ? branches[0].clauses : [or(...branches)],
  )
}

export let except = (q: And, ids: string[]) =>
  ids.length ? and(...q.clauses, ne('entity.eid', list(...ids))) : q

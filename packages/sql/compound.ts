import { from, type Query, select, star, unionAll } from './ast.ts'

// How many terms one compound SELECT may carry, and how a wider question is cut
// up to fit.
//
// Workerd — the runtime under a Durable Object and under D1 — is built with
// SQLITE_MAX_COMPOUND_SELECT = 5, and a sixth term fails with the error
// `too many terms in compound SELECT` (measured 2026-09-05; SQLite's own
// default is 500). Any
// compiler here that unions one term per reference column in the vocabulary
// therefore has a limit that a wide enough vocabulary runs straight into: the
// death cascade (./cascade.ts) and the `.refs=` backlink union (./bind.ts) both
// do.
//
// Cutting keeps every compound SELECT under that limit: a list of terms is cut
// into statements of {@link ARMS} terms each. What the caller does with the
// pieces is its own business: the cascade asks them in rounds and unions the
// answers; a union of rows nests them ({@link unionAllWithin}), as the `.refs=`
// backlink union and a search over every text index (@yaks/fts) do. Each
// reference column is a term of its own rather than one of its table's
// columns combined with OR: an OR scans the table whenever statistics judge
// any one of its columns unselective.

/** How many terms one compound SELECT may carry. Workerd allows five, and a
 * seeded recursion spends one of them on the seed. This is the lowest limit any
 * supported engine has, and so the default everywhere: an engine that allows
 * more declares it, and an engine that forgets to declare it is slow rather
 * than broken. */
export let ARMS = 4

/** What an engine allows when it is not workerd — an embedded SQLite is built
 * with the stock SQLITE_MAX_COMPOUND_SELECT of 500, and a driver over one
 * declares this (`Driver.arms`) so that a query spanning the whole
 * vocabulary stays one statement instead of one per four components. Set below
 * the stock limit rather than at it, because such a query is not the only
 * compound SELECT a statement may contain. */
export let STOCK = 400

/** A list cut into groups of at most `n`. Always at least one group, so a
 * vocabulary with no terms at all still produces the statement that would have
 * wrapped them. */
export let cut = <T>(xs: T[], n: number): T[][] =>
  xs.length <= n ? [xs] : [xs.slice(0, n), ...cut(xs.slice(n), n)]

/** The rows of every part, as one `union all` of them, nested so that no
 * compound SELECT carries more than `n` terms: each `n` parts become one term
 * selecting from their compound, until `n` or fewer are left. The columns are
 * the first part's, as in any compound.
 *
 * ```ts
 * import { lit, render, select, unionAllWithin } from '@yaks/sql'
 *
 * let one = (i: number) => select({ cols: [lit(i)] })
 * render(unionAllWithin([1, 2, 3].map(one), 2)).sql
 * ```
 */
export let unionAllWithin = (parts: Query[], n: number = ARMS): Query =>
  parts.length == 1 ? parts[0] : parts.length <= n ? unionAll(...parts) : (
    unionAllWithin(
      cut(parts, n).map((group, i) =>
        group.length == 1 ? group[0] : select({
          cols: [star()],
          from: from(unionAll(...group), `__arms${i}`),
        })
      ),
      n,
    )
  )

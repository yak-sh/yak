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
// Two steps keep every compound SELECT under that limit, and they compose.
// Group first — a component's columns become one term, combined with OR,
// because terms are scarce and or is not — then cut what is left into
// statements of {@link ARMS} terms each. What the caller does with the pieces
// is its own business: the cascade asks them in rounds and unions the answers;
// the `.refs=` predicate combines them with OR into one where clause.

/** How many terms one compound SELECT may carry. Workerd allows five, and a
 * seeded recursion spends one of them on the seed. This is the lowest limit any
 * supported engine has, and so the default everywhere: an engine that allows
 * more declares it, and an engine that forgets to declare it is slow rather
 * than broken. */
export let ARMS = 4

/** What an engine allows when it is NOT workerd — an embedded SQLite is built
 * with the stock SQLITE_MAX_COMPOUND_SELECT of 500, and a driver over one
 * declares this (`Driver.arms`) so that a query spanning the whole
 * vocabulary stays one statement instead of one per four components. Set below
 * the stock limit rather than at it, because such a query is not the only
 * compound SELECT a statement may contain. */
export let STOCK = 400

/** One term of a compound SELECT: a component table, and every column of it
 * that has the behaviour being asked about. */
export type Arm = [comp: string, props: string[]]

/** Reference properties grouped by the table they belong to, so two of one
 * component cost one term rather than two. */
export let arms = (refs: [string, string][]): Arm[] => {
  let by = new Map<string, string[]>()
  for (let [comp, prop] of refs) by.set(comp, [...(by.get(comp) ?? []), prop])
  return [...by]
}

/** A list cut into groups of at most `n`. Always at least one group, so a
 * vocabulary with no terms at all still produces the statement that would have
 * wrapped them. */
export let cut = <T>(xs: T[], n: number): T[][] =>
  xs.length <= n ? [xs] : [xs.slice(0, n), ...cut(xs.slice(n), n)]

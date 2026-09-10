// What one compound SELECT may carry, and how a wider question is cut to fit.
//
// Workerd — the runtime under a Durable Object and under D1 — is built with
// SQLITE_MAX_COMPOUND_SELECT = 5 and answers a sixth term with `too many terms
// in compound SELECT` (measured 2026-09-05; SQLite's own default is 500). Any
// compiler here that unions one arm per vocabulary column therefore has a
// ceiling a wide enough vocabulary walks straight into: the death cascade
// (./cascade.ts) and the `.refs=` backlink union (./bind.ts) both do.
//
// Two moves keep every compound under the cap, and they compose. GROUP first —
// a component's columns are ONE arm, OR'd, because a term is scarce and `or` is
// not — then CUT what is left into statements of {@link ARMS}. What the caller
// does with the pieces is its own: the cascade asks them in rounds and unions
// the answers; the refs predicate ORs them into one WHERE.

/** How many terms one compound SELECT may carry. Workerd allows five and a
 * seeded recursion spends one of them on the seed. It is the FLOOR, and so the
 * default everywhere: an engine that carries more says so, and an engine that
 * forgets to say is slow rather than broken. */
export let ARMS = 4

/** What an engine carries when it is NOT workerd — an embedded SQLite is built
 * with the stock SQLITE_MAX_COMPOUND_SELECT of 500, and a driver over one says
 * this (@yaks/sqlite `Driver.arms`) so that a vocabulary-wide probe stays one
 * statement instead of one per four components. Under the stock limit, not at
 * it: a probe is not the only compound a statement may carry. */
export let STOCK = 400

/** One arm: a component table, and every column of it wearing this word. */
export type Arm = [comp: string, props: string[]]

/** Reference columns grouped by their table, so two columns of one component
 * cost one term rather than two. */
export let arms = (cols: [string, string][]): Arm[] => {
  let by = new Map<string, string[]>()
  for (let [comp, prop] of cols) by.set(comp, [...(by.get(comp) ?? []), prop])
  return [...by]
}

/** A list cut into groups of at most `n`. Always at least one group, so a
 * vocabulary with no arm at all still states whatever wraps the arms. */
export let cut = <T>(xs: T[], n: number): T[][] =>
  xs.length <= n ? [xs] : [xs.slice(0, n), ...cut(xs.slice(n), n)]

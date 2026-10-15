// The platform's Git door and daily repair cadence. Its store words live in
// facets/git-vocab.ts; the deploy effect is composed through facets/git-effects.ts, its schedule
// is seeded with the directory's others (facets/directory-effects.ts), and the sweep rule through facets/git-graph.ts.

/** When the repair pass runs. Its own hour: it reads every deploy there is,
 * and the trash sweep is already walking every app at 4:20. */
export let DAILY = '50 4 * * *'

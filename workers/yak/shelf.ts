// The offers a stranger chooses among: one per app (T-123595).
//
// An owner who installs their own published app into another space and offers
// the copy there has offered the same app twice, under two names with one
// title, and a browsing agent cannot tell which to take: yourname/recipes is
// jeff/recipes installed and re-offered as the demo. So `app_published` leaves
// out an offer that one of its own owners re-offered from a later copy: the
// copy's pin names it (`installed.of`) and was published after it. A copy
// offered by anyone else never hides the app it came from, or anyone could
// push an app off the list by republishing it. Nothing is unpublished:
// installing by either name still works, and the gallery, which lists only
// what was asked for and approved, is untouched.

/** One offer, as much of directory.ts's `{space, app}` as deciding reads. */
export type Shelved = {
  space: { eid: string }
  app: {
    eid: string
    published: { at: string } | null
    installed: { of: string | null } | null
  }
}

/** The offers whose owners must be known to decide: each copy and the app it
 * came from, when both are on offer. */
export let pairs = <O extends Shelved>(offers: O[]): [O, O][] =>
  offers.flatMap((copy) => {
    let of = offers.find((o) => o.app.eid == copy.app.installed?.of)
    return of && of != copy ? [[of, copy] as [O, O]] : []
  })

/**
 * The offers to list, given each paired space's owners (person eids).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let offer = (eid: string, space: string, at: string, of?: string) => ({
 *   space: { eid: space },
 *   app: {
 *     eid,
 *     published: { name: eid, version: 1, at, about: '' },
 *     installed: of ? { of, version: 1, sandboxed: null } : null,
 *   },
 * })
 * let origin = offer('recipes', 'jeff', '2026-09-22')
 * let demo = offer('recipe-box', 'yourname', '2026-09-28', 'recipes')
 * let names = (o: { app: { eid: string } }[]) => o.map((x) => x.app.eid)
 * // One owner offered the app twice: only the later offer is listed.
 * let mine = new Map([['jeff', ['j']], ['yourname', ['y', 'j']]])
 * assertEquals(names(shelf([demo, origin], mine)), ['recipe-box'])
 * // Somebody else's copy never hides the app it came from.
 * let theirs = new Map([['jeff', ['j']], ['yourname', ['y']]])
 * assertEquals(names(shelf([demo, origin], theirs)), ['recipe-box', 'recipes'])
 * // Nor does a copy offered before the app it came from.
 * let early = offer('recipe-box', 'yourname', '2026-09-01', 'recipes')
 * assertEquals(names(shelf([early, origin], mine)), ['recipe-box', 'recipes'])
 * ```
 */
export let shelf = <O extends Shelved>(
  offers: O[],
  owners: Map<string, string[]>,
): O[] => {
  let shared = (a: string, b: string) =>
    (owners.get(a) ?? []).some((p) => (owners.get(b) ?? []).includes(p))
  let hidden = new Set(
    pairs(offers)
      .filter(([of, copy]) =>
        copy.app.published!.at > of.app.published!.at &&
        shared(of.space.eid, copy.space.eid)
      )
      .map(([of]) => of.app.eid),
  )
  return offers.filter(({ app }) => !hidden.has(app.eid))
}

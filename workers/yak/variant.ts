// Which home page a visitor to yaks.app is shown. A home page is data: a name
// in the funnel (funnel.ts) and the page Site keeps it at. `/` is the "ask"
// page for everyone; every other page shows only at its own address, which is
// where an ad for one audience points. The one a visitor opened last is kept
// with their arrival (arrival.ts), and the steps they take after count under
// it. Nothing here imports anything, so yak-front (front/) holds it.

/** One home page: its name in the funnel and where Site keeps it. */
export type Variant = { name: string; path: string }

/** The page that pitches the Operator (site/operator.tsx). */
export let OPERATOR = '/operator'

/** The home pages: `/` first, then each one shown at its own address. */
export let VARIANTS: Variant[] = [
  { name: 'ask', path: '/' },
  { name: 'describe', path: '/build' },
  { name: 'operator', path: OPERATOR },
  { name: 'church', path: '/churches' },
  { name: 'organization', path: '/organizations' },
  { name: 'township', path: '/townships' },
]

/** The pages Site keeps for the home page (kept-page.ts `LISTINGS`). */
export let PATHS = VARIANTS.map((v) => v.path)

/** The home page this request is shown: the one at its path, or none. */
export let shown = (req: Request, all = VARIANTS): Variant | undefined => {
  let path = new URL(req.url).pathname
  return all.find((v) => v.path == path)
}

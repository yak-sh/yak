import { KEEP } from './kept.ts'

// Which drawing of a page of the site a file holds: a
// hash of its markup, in its head, alike in the Worker's own file and in the
// home app's. A deploy's scripts and sheet are made beside its own files, so
// the app's page goes with them only where it is the same drawing (site.ts
// `sitePage`), and a release of either never meets the other's previous
// markup.

/** The meta tag's name. */
export let DRAWING = 'yak-drawing'

/** The drawing a page's markup names, or null where it names none. */
let drawing = (html: string) =>
  html.match(/<meta\s+name="yak-drawing"\s+content="([^"]*)"/)?.[1] ?? null

/** Choose the released page when its markup matches the deployed scripts.
 * During a deploy, use the built-in page and keep the release's invalidation
 * tags so that publishing the matching drawing replaces it. */
export let compatibleDrawing = async (
  released: Response,
  deployed: Response,
) => {
  let body = await released.text()
  if (!deployed.ok || drawing(body) == drawing(await deployed.clone().text())) {
    await deployed.body?.cancel()
    return new Response(body, released)
  }
  let tags = released.headers.get(KEEP)
  let page = new Response(deployed.body, deployed)
  if (
    !tags || released.headers.has('set-cookie') ||
    released.headers.get('cache-control')?.includes('no-store')
  ) {
    page.headers.set('cache-control', 'private, no-store')
  } else {
    page.headers.set(KEEP, tags)
  }
  return page
}

// Which drawing of a page of the site a file holds (site/mod.ts `page`): a
// hash of its markup, in its head, alike in the Worker's own file and in the
// home app's. A deploy's scripts and sheet are made beside its own files, so
// the app's page goes with them only where it is the same drawing (site.ts
// `sitePage`), and a release of either never meets the other's previous
// markup.

/** The meta tag's name. */
export let DRAWING = 'yak-drawing'

/** The drawing a page's markup names, or null where it names none. */
export let drawing = (html: string) =>
  html.match(/<meta\s+name="yak-drawing"\s+content="([^"]*)"/)?.[1] ?? null

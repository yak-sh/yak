// The page, exported as `@yaks/web/page`: what `/` and every entity's address
// answer (./routes.ts), ./index.html with the tracker's page reporter
// (@yaks/tracker/script) inline, first in its head.
//
// Both are files beside their modules: a checkout reads them from disk, and a
// CLI from JSR would fetch them from jsr.io in every process that serves, on
// the first request. The page is the same whatever a config composes, so a
// release makes it ahead (`prepare`, run by bin/publish.ts) and a host answers
// with that (@yaks/cli/page `ahead`), which Deno keeps once fetched.

import { located } from '@yaks/cli/config'
import { ahead, keep } from '@yaks/cli/page'

// What the made-ahead page is kept under.
let KEY = '@yaks/web page'

// The page reporter as a script element at the page's root, where its door
// `api/report` is. `</script` in its text would end the element early; `<\/`
// is the same string to JavaScript.
let reporter = async () => {
  let { script }: typeof import('@yaks/tracker/script') = await import(
    located('@yaks/tracker/script')
  )
  let code = await script()
  return `<script data-yak-at="/">${
    code.replace(/<\/(script)/gi, '<\\/$1')
  }</script>`
}

/** The page made from its files, its reporter first in its head. */
export let drawn = async (): Promise<string> => {
  let [page, script] = await Promise.all([
    fetch(new URL('./index.html', import.meta.url)).then((r) => r.text()),
    reporter(),
  ])
  return page.replace('<head>', `<head>${script}`)
}

/** The page: the one a release made ahead, or else made now. */
export let page = async (): Promise<string> => (await ahead(KEY)) ?? drawn()

/** Make the page ahead, into `dir`. */
export let prepare = async (dir: URL): Promise<void> =>
  keep(dir, KEY, await drawn())

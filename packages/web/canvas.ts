// The canvas, exported as `@yaks/web/canvas`: the module `/web/app.js`
// answers, the configured application mounted with the views of every plugin
// that draws, bundled for the browser (@yaks/cli/page `bundle`).
//
// Its recipe says what it is made of by name, the same in a checkout and in a
// release, so a release makes a fresh install's canvas ahead (`prepare`, run
// by bin/publish.ts) and a host composed the same way
// answers with that instead of bundling on the person's machine.

import { located, type Plug, subpaths, used } from '@yaks/cli/config'
import { ahead, bundle, keep, type Written } from '@yaks/cli/page'
import type { Registry } from '@yaks/render'
import { application } from './app.ts'
import type { Options } from './routes.ts'

type Views = {
  views?: Registry
  inspectViews?: unknown[]
  destinations?: unknown[]
  home?: unknown
  tabs?: unknown[]
}

let draws = (facet: Views | null) =>
  !!(facet?.views || facet?.inspectViews || facet?.destinations ||
    facet?.home || facet?.tabs)

/** What the canvas of `plugins` is made of, and the entry it bundles. */
export let canvas = async (
  plugins: Plug[],
  options: Options = {},
): Promise<{ recipe: string; entry: Written }> => {
  let names = plugins.map(used)
  let facets = await subpaths(names.map((p) => [p, 'views'])) as (
    | Views
    | null
  )[]
  let views = names.filter((_, i) => draws(facets[i]))
  let chosen = await application(plugins, options.app)
  let specs = views.map((p) => import.meta.resolve(located(`${p}/views`)))
  let code = [
    `import ${JSON.stringify(new URL('./browser.ts', import.meta.url).href)}`,
    `import { mount } from ${JSON.stringify(chosen.mount.href)}`,
    ...specs.map((s, i) => `import * as f${i} from ${JSON.stringify(s)}`),
    `await mount([${specs.map((_, i) => `f${i}`).join(',')}], ${
      JSON.stringify(options.home) ?? 'undefined'
    })`,
  ].join('\n')
  return {
    recipe: JSON.stringify({ app: chosen.plugin, views, home: options.home }),
    entry: { code, at: chosen.entry },
  }
}

/** The canvas of `plugins`: the one a release made ahead for the same
 * recipe, or else bundled now. */
export let made = async (
  plugins: Plug[],
  options: Options = {},
  signal?: AbortSignal,
): Promise<string> => {
  let { recipe, entry } = await canvas(plugins, options)
  return (await ahead(recipe)) ?? bundle(entry, signal)
}

/** Make the canvas of `plugins` ahead, into `dir`. */
export let prepare = async (dir: URL, plugins: Plug[]): Promise<void> => {
  let { recipe, entry } = await canvas(plugins)
  await keep(dir, recipe, await bundle(entry))
}

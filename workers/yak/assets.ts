// yaks.app's own files, as a browser fetches them from Cloudflare's ASSETS,
// said as data and written into public/ by @yaks/web/assets `write`.
//
// Made, and gitignored: the store client an app's pages import
// (@yaks/platform/client), as one module (`_client.js`, served at
// `./api/client.js`): fetched as parts, the parts were a round trip after
// the client's own on every load. The browser modules of packages and of
// this Worker the platform's pages load, each with all it imports. The
// Operator chat page's words (`_words.js`, operator-words.ts). The site's own
// pages (site/mod.ts). And the kit's share of the look (sheet-assets.ts
// `kit`), with what it points at under `_ui/`. Those last three are drawn
// (`drawn`), from modules loaded only to draw them, so what only names the
// files by their bytes loads none.
//
// Named by their bytes, so a later page never asks again (`planned`): the
// stylesheets, each root with its `@import`s written in place, so a page
// waits on one fetch instead of a chain, and its `light-dark()` pairs said
// again in halves (@yaks/ui `halved`); what a sheet points at (the pencil,
// the paper, the fonts); and the scripts and icons the pages name. Each
// keeps answering at its own address too, as pages already shipped name it.
import { type Asset, plan, reading, write } from '@yaks/web/assets'
import { halved } from '@yaks/ui'
import { kit } from './sheet-assets.ts'
import { pageDocs } from './operator-words.ts'

let here = (path: string) => new URL(path, import.meta.url)
let of = (specifier: string) => new URL(import.meta.resolve(specifier))

/** The files of the site but those it draws (`drawn`). */
export let ASSETS: Asset[] = [
  { name: '_client.js', bundle: of('@yaks/platform/client'), named: true },
  { name: '_draft.js', bundle: of('@yaks/draft/browser') },
  { name: '_outbox.js', bundle: of('@yaks/sync/outbox') },
  { name: '_wire.js', bundle: of('@yaks/vocab/wire') },
  { name: 'chart.js', bundle: here('./chart.js'), named: true },
  { name: 'data.js', bundle: here('./data-editor.js') },
  { name: '_dates.js', bundle: here('./dates-browser.ts'), named: true },
  // Edit mode on an app's page, loaded by its pencil (public/edit.js).
  { name: '_edit.js', bundle: here('./edit-mode.ts') },
  // The Operator chat's conversation (operator-rows.ts), for its page alone.
  { name: '_talk.js', bundle: here('./operator-rows.ts') },
  { name: '_settings.js', bundle: here('./settings.ts'), named: true },
  { name: '_alerts.js', bundle: here('./alerts-browser.ts'), named: true },
  { name: '_sort.js', bundle: here('./sort.ts') },
  ...['style.css', 'pages.css'].map((name) => ({ name, named: true })),
  ...[
    'report.js',
    'deploy.js',
    'drop.js',
    'idle.js',
    'menu.js',
    'side.js',
    'pane.js',
    'find.js',
    'modal.js',
    'cta.js',
    'saving.js',
    'township-dues.js',
    'carousel.js',
    'walk.js',
    'wander.js',
    'sky.js',
    'favicon-32.png',
    'apple-touch-icon.png',
  ].map((name) => ({ name, named: true })),
]

/** Each named file's address of its bytes, and the bytes, as the build left
 * them in `dir`. */
export let planned = (dir: string) => plan(ASSETS, reading(dir), halved)

/** What the build draws: the Operator store's words as its chat page's
 * graph holds them, the site's pages and the kit's sheet. */
export let drawn = async (): Promise<Asset[]> => {
  let [{ page, PAGES }, { operatorVocab }, sheet] = await Promise.all([
    import('./site/mod.ts'),
    import('./operator-store.ts'),
    kit(),
  ])
  return [
    {
      name: '_words.js',
      body: () =>
        `export default ${JSON.stringify(pageDocs(operatorVocab.docs))}\n`,
    },
    ...Object.keys(PAGES).map((name) => ({ name, body: () => page(name) })),
    ...sheet,
  ]
}

/** Write every file into `to`, leaving none of an earlier build's names or
 * kit behind. */
export let build = async (to = here('./public/').pathname) =>
  write(to, [...ASSETS, ...await drawn()], { fresh: ['_ui'], sheet: halved })

if (import.meta.main) await build()

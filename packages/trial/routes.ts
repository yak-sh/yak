/**
 * `/trial/<round>`: the page a person taps through a round's pairs on
 * (./page.ts), and, asked for JSON, the decks it shows. Several rounds are
 * named with commas and shown one after another: `/trial/taste1,copy-r1`.
 * The decks are the configured person's: their taps so far ride on each card.
 *
 * @module
 */
import type { Route } from '@yaks/api'
import type { Config } from '@yaks/cli/config'
import { person } from '@yaks/cli/host'
import { bundle, kept } from '@yaks/cli/page'
import type { Graph } from '@yaks/graph'
import { find, gather } from './round.ts'
import { deck } from './skill.ts'

/** What this facet reads off its host. */
export type Hosting = {
  config?: Config
  graph: Graph
  /** aborts as the host closes, ending the script's build */
  stopping?: AbortSignal
}

let CSS = `
:root { color-scheme: light dark; --ink: #1c1b19; --soft: #6b665e; --paper: #f6f3ec; --card: #fffdf8; --line: #d9d3c5; --pick: #2f6f4f; }
@media (prefers-color-scheme: dark) { :root { --ink: #ece7dc; --soft: #a39c8f; --paper: #171614; --card: #22201d; --line: #3a362f; --pick: #7fc8a0; } }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.45 -apple-system, system-ui, "Segoe UI", sans-serif; }
main { max-width: 34rem; margin: 0 auto; padding: 0 .75rem 3rem; }
header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: .5rem; padding: .5rem 0; background: var(--paper); }
header .place { flex: 1; text-align: center; color: var(--soft); font-size: .85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button { font: inherit; color: inherit; background: none; border: 1px solid var(--line); border-radius: .6rem; padding: .55rem .9rem; min-height: 2.75rem; touch-action: manipulation; }
button:disabled { opacity: .3; }
header button { min-width: 2.75rem; font-size: 1.4rem; line-height: 1; padding: 0; }
.about { margin: .25rem 0 .6rem; color: var(--soft); font-size: .85rem; }
.pitch { background: var(--card); border: 2px solid var(--line); border-radius: .9rem; padding: .9rem 1rem .6rem; margin-bottom: .75rem; cursor: pointer; -webkit-tap-highlight-color: transparent; animation: in .14s ease-out; }
.pitch:active { border-color: var(--pick); }
.pitch.chosen, .neither.chosen { border-color: var(--pick); box-shadow: inset 0 0 0 1px var(--pick); }
.pitch h2 { margin: 0 0 .4rem; font-size: 1.3rem; line-height: 1.2; }
.pitch p { margin: 0 0 .55rem; }
.pitch .more { color: var(--soft); font-size: .95rem; }
.pitch footer { display: flex; justify-content: space-between; gap: .5rem; margin-top: .2rem; }
.pitch footer button { border: 0; padding: .4rem .2rem; color: var(--soft); font-size: .9rem; }
.pitch .grab { margin-left: auto; }
.pitch .grab[aria-pressed=true] { color: var(--pick); font-weight: 600; }
.neither { display: block; width: 100%; margin-bottom: .75rem; }
input, textarea { display: block; width: 100%; font: inherit; color: inherit; background: var(--card); border: 1px solid var(--line); border-radius: .6rem; padding: .6rem .75rem; margin-bottom: .75rem; }
.quiet { border: 0; color: var(--soft); font-size: .9rem; }
.own button[type=submit] { background: var(--pick); border-color: var(--pick); color: var(--paper); }
.done { margin: 3rem 0; text-align: center; color: var(--soft); }
.status { min-height: 1.4em; color: var(--soft); font-size: .8rem; text-align: center; }
@keyframes in { from { opacity: 0; transform: translateY(6px); } }
`

/** The page: its styles, an empty `main` and the script that fills it. */
export let PAGE: string = '<!doctype html><html lang="en"><head>' +
  '<meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<meta name="robots" content="noindex">' +
  `<title>Which would you rather read?</title><style>${CSS}</style></head>` +
  '<body><main></main>' +
  '<script type="module" src="/trial.js"></script></body></html>'

/** The page at `/trial/<round>`, its decks as JSON, and its script. */
export let routes = (host: Hosting): Route[] => {
  let page = kept(
    '/trial',
    'text/html; charset=utf-8',
    () => Promise.resolve(PAGE),
  )
  let decks = async (request: Request) => {
    let words = decodeURIComponent(
      new URL(request.url).pathname.slice('/trial/'.length),
    ).split(',').filter((w) => w)
    let judge = await person({
      graph: host.graph,
      config: host.config ?? { db: ':memory:', plugins: [] },
    })
    let made = []
    for (let word of words) {
      let round = await find(host.graph, word)
      made.push(deck(await gather(host.graph, round), judge ?? undefined))
    }
    return Response.json({ decks: made }, {
      headers: { 'cache-control': 'no-store' },
    })
  }
  return [
    {
      method: 'GET',
      path: '/trial/*',
      handle: (request) =>
        request.headers.get('accept')?.includes('application/json')
          ? decks(request)
          : page(request),
      says: 'a round of a skill trial, as pairs to tap through',
    },
    {
      method: 'GET',
      path: '/trial.js',
      handle: kept(
        '/trial.js',
        'text/javascript; charset=utf-8',
        (signal) => bundle(new URL('./main.ts', import.meta.url), signal),
        { closing: host.stopping },
      ),
    },
  ]
}

// How the `yak` command shows a tool's answer. A tool returns bundles and never
// keeps the terminal; drawing them is the caller's, through the same @yaks/render
// views a browser draws with. Printed, they go through @yaks/text as plain
// lines; under `--tui`, @yaks/preact mounts them in @yaks/tui, which holds the
// terminal until Ctrl-C.
//
// The views are every configured plugin's `./views`, then @yaks/tools' (the
// host always carries its `content`), then the generic ones any entity has
// (@yaks/web/views) — the order @yaks/web's browser registers them in, so an
// entity reads the same in both. A lone entity is shown whole, as its `Page`;
// several are a `Tile` each, one line apiece.

import type { Bundle } from '@yaks/graph'
import { human, short } from '@yaks/id'
import { define, type Registry } from '@yaks/render'
import { render, tree } from '@yaks/text'
import type { Vocab } from '@yaks/vocab'
import { type Shown, views as generic } from '@yaks/web/views'
import { subpath } from './host.ts'

/** How one plugin's `./views` becomes a module: {@link subpath} unless a test
 * hands its modules over inline. */
export type Views = (plugin: string) => Promise<{ views?: Registry } | null>

/** Every view the `yak` command draws with, most knowing first. */
export let registry = async (
  plugins: string[],
  load: Views = (plugin) => subpath(plugin, 'views'),
): Promise<Registry> => {
  let named = [...new Set([...plugins, '@yaks/tools'])]
    .filter((p) => p != '@yaks/web')
  let found = await Promise.all(named.map(load))
  return define([
    ...found.flatMap((m) => m?.views?.renderers ?? []),
    ...generic.renderers,
  ])
}

// What a view cannot know from one bundle, for a terminal: an entity another
// names reads as its id where the answer holds it, nothing links, and a moment
// reads as written.
let shown = <Node>(
  vocab: Vocab,
  answer: Bundle[],
  draw: (b: Bundle, view: string, ctx: Shown<Node>) => Node | null,
): Shown<Node> => {
  let id = human(vocab)
  let held = new Map(answer.map((b) => [b.entity.eid, b]))
  let ctx: Shown<Node> = {
    id,
    kind: (b) => vocab.kindOf(b) || 'entity',
    name: (eid) => {
      let b = held.get(eid)
      return b ? id(b) : short(eid)
    },
    when: (at) => at,
    show: (b, view) => draw(b, view, ctx),
  }
  return ctx
}

let viewOf = (answer: Bundle[]) => answer.length == 1 ? 'Page' : 'Tile'

/** An answer as the lines a terminal prints. */
export let printed = (
  views: Registry,
  vocab: Vocab,
  answer: Bundle[],
): string => {
  let ctx = shown(vocab, answer, (b, v, c) => tree(views, b, v, vocab, c))
  return answer
    .map((b) => render(views, b, viewOf(answer), vocab, ctx, 'plain'))
    .filter(Boolean)
    .join('\n')
}

/** An answer held in the terminal (@yaks/tui) until Ctrl-C. Loaded only when
 * asked for, so a printed answer never pays for a terminal app. */
export let hold = async (
  views: Registry,
  vocab: Vocab,
  answer: Bundle[],
): Promise<void> => {
  let [{ h }, { render: mount }, { run, Scroll }] = await Promise.all([
    import('preact'),
    import('@yaks/preact'),
    import('@yaks/tui'),
  ])
  let ctx = shown(vocab, answer, (b, v, c) => mount(views, b, v, vocab, c))
  let view = viewOf(answer)
  await run(() =>
    h(
      Scroll,
      { id: 'answer', grow: '1' },
      answer.map((b) => h('div', null, mount(views, b, view, vocab, ctx))),
    )
  )
}

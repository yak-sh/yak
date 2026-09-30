/**
 * The style guide in a terminal: `yak ui`, a rendering mode of the CLI
 * (./cli.ts). The page a browser gets at `/ui` (./guide.ts), painted by
 * @yaks/tui through each part's terminal sheet, and framed in the kit's own
 * parts: the themes as tabs over an index of the parts, and beside them the
 * page the walk is on, the whole guide or one part's section.
 *
 * Keys: j and k walk the index, and the page follows; ↑ ↓ PgUp PgDn scroll
 * the page; t paints everything in the next theme; q quits. A press on an
 * entry or a tab picks it.
 *
 * @module
 */

import { signal } from '@preact/signals'
import { h } from 'preact'
import { type Key, quit, run, Scroll, useKeys } from '@yaks/tui'
import { Guide, Specimens } from './guide.ts'
import { Index } from './Index.ts'
import { kit, sheet, themes } from './kit.ts'
import { Panes } from './Panes.ts'
import { Tabs } from './Tabs.ts'

// Where the walk stops: the whole guide, then each part.
let pages = ['', ...Object.keys(kit)]

/** Hold the style guide in this terminal until q or Ctrl-C. */
export let open = async (): Promise<void> => {
  let names = Object.keys(themes)
  let sheets = names.map((n) => sheet(themes[n]))
  let at = signal(0)
  let theme = signal(0)
  let walk = (i: number) =>
    at.value = Math.max(0, Math.min(pages.length - 1, i))
  let press = (k: Key): boolean => {
    let c = k.name == 'char' ? k.text : undefined
    if (c == 'q') quit()
    else if (c == 'j' || c == 'k') walk(at.value + (c == 'j' ? 1 : -1))
    else if (c == 't') theme.value = (theme.value + 1) % names.length
    else return false
    return true
  }
  // An index entry: where it is, lit and kept in view while the walk is on it.
  let entry = (i: number) => ({
    key: pages[i],
    href: `#${pages[i]}`,
    mod: i == at.value && 'on',
    reveal: i == at.value ? '' : undefined,
    onClick: () => walk(i),
  })
  let App = () => {
    // Keys typed faster than a read arrive as one run of characters: each is
    // its own press, the way it was typed.
    useKeys((k) =>
      k.name == 'char' && !k.alt && (k.text?.length ?? 0) > 1
        ? [...k.text!].map((text) => press({ ...k, text })).some(Boolean)
        : press(k)
    )
    let here = pages[at.value]
    return h(
      'div',
      { col: '' },
      h(
        Panes,
        {},
        h(
          Panes.Pane,
          { mod: 'nav' },
          h(
            Panes.Top,
            {},
            h(
              Tabs,
              {},
              names.map((name, i) =>
                h(Tabs.Tab, {
                  key: name,
                  type: 'button',
                  mod: i == theme.value && 'on',
                  onClick: () => theme.value = i,
                }, name)
              ),
            ),
          ),
          h(
            Scroll,
            { id: 'ui index', grow: '1', follow: false, keyboard: false },
            h(
              Index,
              {},
              h(
                Index.Group,
                {},
                h(Index.Head, entry(0), '@yaks/ui'),
                pages.slice(1).map((name, i) =>
                  h(Index.Item, entry(i + 1), name)
                ),
              ),
            ),
          ),
        ),
        h(
          Panes.Pane,
          { mod: ['main', 'on'] },
          h(
            Scroll,
            { id: `ui page ${here}`, grow: '1', follow: false },
            here ? h(Specimens, { name: here }) : h(Guide, null),
          ),
        ),
      ),
      h(
        'div',
        { class: 'Muted' },
        'j k parts · ↑ ↓ PgUp PgDn scroll · t theme · q quit',
      ),
    )
  }
  await run(App, { sheet: () => sheets[theme.value] })
}

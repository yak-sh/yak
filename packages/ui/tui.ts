/**
 * The style guide in a terminal: `yak ui`, a rendering mode of the CLI
 * (./cli.ts). The guide a browser gets at `/ui` (./guide.ts), painted by
 * @yaks/tui through each part's terminal sheet, and framed as the browser
 * frames it: beside the page, a nav of the guide's contents under the theme
 * switcher. The walk stops where the contents do (the whole guide, each
 * group, each part), and the page is the one the walk is on.
 *
 * Keys: j and k walk the contents, and the page follows; ↑ ↓ PgUp PgDn
 * scroll the page; t paints everything in the next theme; q quits. A press
 * on an entry or a theme picks it.
 *
 * @module
 */

import { signal } from '@preact/signals'
import { h } from 'preact'
import { type Key, quit, run, Scroll, useKeys } from '@yaks/tui'
import { Contents, Page, stops } from './guide.ts'
import { sheet, themes } from './kit.ts'
import { Pairs } from './Pairs.ts'
import { Panes } from './Panes.ts'
import { Tabs } from './Tabs.ts'

/** Hold the style guide in this terminal until q or Ctrl-C. */
export let open = async (): Promise<void> => {
  let names = Object.keys(themes)
  let sheets = names.map((n) => sheet(themes[n]))
  let at = signal(0)
  let theme = signal(0)
  let walk = (i: number) =>
    at.value = Math.max(0, Math.min(stops.length - 1, i))
  let press = (k: Key): boolean => {
    let c = k.name == 'char' ? k.text : undefined
    if (c == 'q') quit()
    else if (c == 'j' || c == 'k') walk(at.value + (c == 'j' ? 1 : -1))
    else if (c == 't') theme.value = (theme.value + 1) % names.length
    else return false
    return true
  }
  // A contents entry: where it goes, lit and kept in view while the walk is
  // on it.
  let entry = (stop: string) => {
    let i = stops.indexOf(stop)
    return {
      href: `#${stop}`,
      mod: i == at.value && 'on',
      reveal: i == at.value ? '' : undefined,
      onClick: () => walk(i),
    }
  }
  let App = () => {
    // Keys typed faster than a read arrive as one run of characters: each is
    // its own press, the way it was typed.
    useKeys((k) =>
      k.name == 'char' && !k.alt && (k.text?.length ?? 0) > 1
        ? [...k.text!].map((text) => press({ ...k, text })).some(Boolean)
        : press(k)
    )
    let here = stops[at.value]
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
              Pairs,
              {},
              h(Pairs.Key, {}, 'theme'),
              h(
                Pairs.Value,
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
            ),
          ),
          h(
            Scroll,
            { id: 'ui index', grow: '1', follow: false, keyboard: false },
            h(Contents, { entry }),
          ),
        ),
        h(
          Panes.Pane,
          { mod: ['main', 'on'] },
          h(
            Scroll,
            { id: `ui page ${here}`, grow: '1', follow: false },
            h(Page, { stop: here }),
          ),
        ),
      ),
      h(
        'div',
        { class: 'Muted' },
        'j k contents · ↑ ↓ PgUp PgDn scroll · t theme · q quit',
      ),
    )
  }
  await run(App, { sheet: () => sheets[theme.value] })
}

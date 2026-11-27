/**
 * The style guide in a terminal: `yak ui`, a rendering mode of the CLI
 * (./cli.ts). The guide a browser gets at `/ui` (./guide.ts), painted by
 * @yaks/tui through each part's terminal sheet, and framed as the browser
 * frames it: beside the page, a nav of the guide's contents under the theme
 * switcher. The walk stops where the contents do (the whole guide, each
 * group, each part), and the page is the one the walk is on.
 *
 * Keys: j and k walk the contents, and the page follows; ↑ ↓ PgUp PgDn
 * scroll the page; t paints everything in the next theme; s switches skin; q quits. A press
 * on an entry or a theme picks it.
 *
 * @module
 */

import { useStore } from './store.ts'
import { createElement as h } from 'react'
import { type Key, quit, run, Scroll, useKeys } from '@yaks/tui'
import { Contents, Page, stops } from './guide.ts'
import { kits, sheet, skins, themes } from './kit.ts'
import { Pairs } from './Pairs.ts'
import { Panes } from './Panes.ts'
import { Tabs } from './Tabs.ts'

/** A terminal guide instance, with its live composition sheet. */
export let terminalGuide = () => {
  let names = Object.keys(themes)
  let skinNames = ['base', ...Object.keys(skins)]
  // The walk's stop, and the theme and skin painted (the default skin is
  // the first after the kit's own), read by the App and by the sheet.
  let now = { at: 0, theme: 0, skin: 1 }
  let readers = new Set<() => void>()
  let set = (next: Partial<typeof now>) => {
    now = { ...now, ...next }
    for (let wake of [...readers]) wake()
  }
  let subscribe = (wake: () => void) => {
    readers.add(wake)
    return () => void readers.delete(wake)
  }
  let dressed = () => ({
    kits,
    theme: themes[names[now.theme]],
    skin: skins[skinNames[now.skin]],
  })
  let walk = (i: number) =>
    set({ at: Math.max(0, Math.min(stops.length - 1, i)) })
  let press = (k: Key): boolean => {
    let c = k.name == 'char' ? k.text : undefined
    if (c == 'q') quit()
    else if (c == 'j' || c == 'k') walk(now.at + (c == 'j' ? 1 : -1))
    else if (c == 's') set({ skin: (now.skin + 1) % skinNames.length })
    else if (c == 't') set({ theme: (now.theme + 1) % names.length })
    else return false
    return true
  }
  // A contents entry: where it goes, lit and kept in view while the walk is
  // on it.
  let entry = (stop: string) => {
    let i = stops.indexOf(stop)
    return {
      href: `#${stop}`,
      mod: i == now.at && 'on',
      reveal: i == now.at ? '' : undefined,
      onClick: () => walk(i),
    }
  }
  let App = () => {
    let { at, skin, theme } = useStore(subscribe, () => now)
    // Keys typed faster than a read arrive as one run of characters: each is
    // its own press, the way it was typed.
    useKeys((k) =>
      k.name == 'char' && !k.alt && (k.text?.length ?? 0) > 1
        ? [...k.text!].map((text) => press({ ...k, text })).some(Boolean)
        : press(k)
    )
    let here = stops[at]
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
              h(Pairs.Key, {}, 'skin'),
              h(
                Pairs.Value,
                {},
                h(
                  Tabs,
                  {},
                  skinNames.map((name, i) =>
                    h(Tabs.Tab, {
                      key: name,
                      type: 'button',
                      mod: i == skin && 'on',
                      onClick: () => set({ skin: i }),
                    }, name)
                  ),
                ),
              ),
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
                      mod: i == theme && 'on',
                      onClick: () => set({ theme: i }),
                    }, name)
                  ),
                ),
              ),
            ),
          ),
          h(
            Scroll,
            { id: 'ui index', grow: '1', follow: false, keyboard: false },
            h(Contents, { entry, composition: dressed() }),
          ),
        ),
        h(
          Panes.Pane,
          { mod: ['main', 'on'] },
          h(
            Scroll,
            { id: `ui page ${here}`, grow: '1', follow: false },
            h(Page, { stop: here, composition: dressed() }),
          ),
        ),
      ),
      h(
        'div',
        { className: 'Muted' },
        `j k contents · ↑ ↓ PgUp PgDn scroll · t theme · s skin (${
          skinNames[skin]
        }) · q quit`,
      ),
    )
  }
  return { App, sheet: () => sheet(dressed()) }
}

/** Hold the style guide in this terminal until q or Ctrl-C. */
export let open = async (): Promise<void> => {
  let guide = terminalGuide()
  await run(guide.App, { sheet: guide.sheet })
}

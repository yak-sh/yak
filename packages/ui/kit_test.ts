import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { print } from '@yaks/tui/print'
import { h, type VNode } from 'preact'
import { Dot } from './Dot.ts'
import { everforest } from './everforest.ts'
import { kits } from './kit.ts'
import { Guide } from './guide.ts'
import { sheet, stylesheet, themes } from './kit.ts'
import { Menu } from './Menu.ts'
import { Tabs } from './Tabs.ts'

// deno-lint-ignore no-control-regex -- the painter's colours, to read the words
let plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
let fg = (hex: string) =>
  `38;2;${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(';')}`

test("a theme's colours are its stylesheet's dark ones", async () => {
  for (let [theme, { css, colors }] of Object.entries(themes)) {
    let text = await (await fetch(css)).text()
    let said = Object.fromEntries(
      [...text.matchAll(/--([\w-]+):\s*light-dark\([^,]+,\s*([^)]+)\)/g)]
        .map(([, k, v]) => [k, v]),
    )
    let { hues, ...named } = colors
    let want = {
      ...named,
      ...Object.fromEntries(hues.map((h, i) => [`hue-${i}`, h])),
    }
    for (let [name, hex] of Object.entries(want)) {
      assertEquals(said[name], hex, `${theme} --${name}`)
    }
  }
})

test('a browser gets the theme, then every part', async () => {
  let css = await stylesheet({ kits, theme: everforest })
  assert(css.indexOf('--bg:') < css.indexOf('.Dot {'))
  assert(css.includes('.Menu_Item-danger'))
})

test('a part paints in a terminal in the theme: shape a glyph, tone a colour', () => {
  let dress = sheet({ kits, theme: everforest })
  let c = everforest.colors
  let cases: [string[], string][] = [
    [[], `\x1b[${fg(c.dim)}m●`],
    [['half', 'active'], `\x1b[${fg(c.active)}m◐`],
    [['check', 'positive'], `\x1b[${fg(c.positive)}m✓`],
    [['alert', 'negative'], `\x1b[${fg(c.negative)};1m!`],
  ]
  for (let [mod, want] of cases) {
    assert(print(h(Dot, { mod }), 20, dress).includes(want), want)
  }
  // A menu's items are rows, as in a browser, though each is a button.
  let { Item, Rule } = Menu
  let menu: VNode = h(
    Menu,
    {},
    h(Item, {}, 'open'),
    h(Item, {}, 'copy'),
    h(Rule, {}),
    h(Item, { mod: 'danger' }, 'delete'),
  )
  assertEquals(plain(print(menu, 20, dress)).split('\n'), [
    'open',
    'copy',
    '────────',
    'delete',
  ])
})

test("a tab's badge stands beside its face, never over it", () => {
  let { Tab, Badge } = Tabs
  let tab = h(Tabs, {}, h(Tab, {}, 'Mail', h(Badge, {}, '12')))
  assertEquals(
    plain(print(tab, 20, sheet({ kits, theme: everforest }))),
    'Mail 12',
  )
})

test('the style guide paints in a terminal', () => {
  let out = plain(
    print(h(Guide, null), 100, sheet({ kits, theme: everforest })),
  )
  for (let label of ['Dot-ring', 'Id-retired', 'Stamp', 'Tip', 'table']) {
    assert(out.includes(label), label)
  }
})

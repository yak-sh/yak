/** The Vale composition's carried assets and display contracts, through
 * browser serialization and the terminal painter without a live game. */
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { print } from '@yaks/tui/print'
import { parts, sheet, stylesheet } from '@yaks/ui'
import { h } from 'preact'
import { render } from 'npm:preact-render-to-string@6.7.0'
import {
  composition,
  kit,
  ValeCompass,
  ValeKeycap,
  ValeMeter,
  ValeOrb,
  ValeToast,
} from './ui-kit.ts'

// deno-lint-ignore no-control-regex -- read the terminal painter's words
let plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
let fg = (hex: string) =>
  `38;2;${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(';')}`

test('Vale composition puts the theme before kit and skin fallback assets', async () => {
  let css = await stylesheet(composition)
  let all = parts(composition)
  let urls = [
    composition.theme.css,
    ...Object.entries(all).map(([name, p]) =>
      composition.skin?.[name]?.css ?? p.css
    ),
  ]
  let originals = await Promise.all(
    urls.map(async (url) => await (await fetch(url)).text()),
  )
  assert(css.startsWith(originals[0].slice(0, originals[0].indexOf('@import'))))
  assert(css.includes(new URL('./ui/theme.css', import.meta.url).href))
  for (let text of originals) {
    assert(css.includes(text.slice(text.lastIndexOf('}') - 20)))
  }
  assert(css.indexOf('--bg:') < css.indexOf('.ValeMeter {'))
  assert(css.includes('var(--book-round)'))
  assert(css.includes('.Dot {')) // a base part that the skin does not replace
  assert(css.includes('.ValeCompass_Mark'))
  let dress = sheet(composition)
  assertEquals(dress.Button, all.Button.sheet(composition.theme.colors).Button)
  assertEquals(
    dress.ValeOrb,
    kit.ValeOrb.sheet(composition.theme.colors).ValeOrb,
  )
})

test('Vale semantic colours in the terminal resolve the current browser tokens', async () => {
  let mapped = await (await fetch(composition.theme.css)).text()
  let source = await (await fetch(new URL('./ui/theme.css', import.meta.url)))
    .text()
  let tokens = Object.fromEntries(
    [...source.matchAll(/--([\w-]+):\s*(#[\da-f]+);/g)].map((
      [, k, v],
    ) => [k, v]),
  )
  let roles = Object.fromEntries(
    [...mapped.matchAll(/--([\w-]+):\s*var\(--([\w-]+)\);/g)]
      .map(([, k, v]) => [k, tokens[v]]),
  )
  let { hues, ...colors } = composition.theme.colors
  for (let [role, value] of Object.entries(colors)) {
    assertEquals(roles[role], value, role)
  }
  hues.forEach((value, i) => assertEquals(roles[`hue-${i}`], value))
})

test('Vale specimens carry browser content and paint in the terminal', () => {
  let dress = sheet(composition)
  let expected = {
    ValeMeter: ['Health', 'Experience'],
    ValeKeycap: ['M', 'Shift + Enter'],
    ValeToast: [
      'trail',
      'Quest completed',
      'Inventory full',
      'Legendary found',
    ],
    ValeOrb: ['⌖', 'J', 'P', '♧'],
    ValeCompass: ['N', 'E'],
  }
  for (let [name, words] of Object.entries(expected)) {
    let samples = kit[name].specimens()
    let html = samples.map(([, node]) => render(node)).join('\n')
    let terminal = samples.map(([, node]) => plain(print(node, 80, dress)))
      .join('\n')
    for (let word of words) {
      assert(html.includes(word), `${name}: browser ${word}`)
      assert(terminal.includes(word), `${name}: terminal ${word}`)
    }
  }
  let toast = print(h(ValeToast, { tone: 'positive' }, 'Saved'), 40, dress)
  assert(toast.includes(fg(composition.theme.colors.positive)))
  assert(render(h(ValeKeycap, { keycap: '<Esc>' })).includes('&lt;Esc>'))
})

test('a meter clamps supplied values without dropping its accessible numbers', () => {
  let html = render(h(ValeMeter, { label: 'Health', value: 200, max: 100 }))
  assert(html.includes('aria-valuenow="100"'))
  assert(html.includes('--k:1'))
  assert(html.includes('Health 100/100'))
  let empty = render(h(ValeMeter, { label: 'Health', value: NaN, max: 0 }))
  assert(empty.includes('--k:0'))
  assert(empty.includes('Health 0/0'))
})

test('orb and compass display supplied meaning without game or input state', () => {
  let orb = render(
    h(ValeOrb, { label: 'Map', selected: true, attention: true }),
  )
  assert(orb.includes('aria-label="Map"'))
  assert(orb.includes('aria-pressed="true"'))
  assert(orb.includes('ValeOrb-on ValeOrb-new'))
  let compass = h(ValeCompass, { bearing: -90, destination: 450 })
  let html = render(compass)
  assert(html.includes('Bearing 270°, destination 90°'))
  assert(html.includes('--turn:270deg'))
  let terminal = plain(print(compass, 40, sheet(composition)))
  assert(terminal.includes('270°'))
  assert(terminal.includes('◆'))
})

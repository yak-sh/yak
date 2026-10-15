/** HUD display contracts through browser serialization and the terminal
 * painter, supplied only display values rather than a running game. */
import { equal, ok, test } from '@yaks/testing'
import { everforest, sheet } from '@yaks/ui'
import { print } from '@yaks/tui/print'
import { h } from 'preact'
import { render } from 'npm:preact-render-to-string@6.7.0'
import { Grid, kit, Stats, Stick } from './hud.ts'

let dress = sheet({ kits: { game: kit }, theme: everforest })
// deno-lint-ignore no-control-regex -- compare the terminal painter's words
let plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

test('HUD inventory cells distinguish a supplied pick from a passive display', () => {
  let passive = render(h(Grid.Cell, {}, h(Grid.Picture, {}, 'Sword')))
  ok(passive.startsWith('<span'))
  ok(!passive.includes('aria-current'))
  let picked = render(
    h(Grid.Cell, { onClick: () => {}, mod: ['on', 'dim'] }, 'Sword'),
  )
  ok(picked.startsWith('<button'))
  ok(picked.includes('type="button"'))
  ok(picked.includes('aria-current="true"'))
  ok(picked.includes('Grid_Cell-on Grid_Cell-dim'))
  let other = render(h(Grid.Cell, { onClick: () => {} }, 'Shield'))
  ok(other.includes('aria-current="false"'))
})

test('HUD stat comparisons preserve supplied content in both hosts', () => {
  let node = h(
    Stats,
    { mod: 'two' },
    h(
      Stats.Stat,
      {},
      h(Stats.Mark, {}, '⚔'),
      h(Stats.Words, {}, 'Attack 13 → ', h(Stats.Better, {}, '14')),
    ),
    h(Stats.Stat, {}, 'Health 91 → ', h(Stats.Worse, {}, '80')),
  )
  let html = render(node), text = plain(print(node, 80, dress))
  ok(html.includes('Stats-two'))
  ok(html.includes('Stats_Better'))
  ok(html.includes('Stats_Worse'))
  ok(text.includes('Attack 13 → 14'))
  ok(text.includes('Health 91 → 80'))
})

test('HUD touch stick displays supplied pixels and recenters when resting', () => {
  let held = render(h(Stick, { rest: false, x: 70, y: 120, dx: -20, dy: 10 }))
  ok(held.includes('translate(70px, 120px)'))
  ok(held.includes('translate(-20px, 10px)'))
  ok(held.includes('aria-hidden="true"'))
  ok(!held.includes('Stick-rest'))
  let rest = render(h(Stick, { rest: true, x: 70, y: 120, dx: -20, dy: 10 }))
  ok(rest.includes('Stick-rest'))
  ok(!rest.includes('transform'))
  ok(render(h(Stick, {})).includes('Stick-rest'))
  ok(!render(h(Stick, { rest: false, x: NaN, dx: Infinity })).includes('NaN'))
  ok(
    !render(h(Stick, { rest: false, x: NaN, dx: Infinity })).includes(
      'Infinity',
    ),
  )
  equal(print(h(Stick, { rest: false }), 80, dress), '')
})

test('HUD kit specimens carry inventory and comparison words in both hosts', () => {
  let expected = {
    Grid: ['⚔', '24', '12', 'Weapon', 'Nothing'],
    Stats: ['Weapon power', 'Health', '13 →', '14', '0.52 s'],
  }
  for (let [name, words] of Object.entries(expected)) {
    let samples = kit[name].specimens()
    let html = samples.map(([, node]) => render(node)).join('\n')
    let text = samples.map(([, node]) => plain(print(node, 80, dress))).join(
      '\n',
    )
    for (let word of words) {
      ok(html.includes(word), `${name}: browser ${word}`)
      ok(text.includes(word), `${name}: terminal ${word}`)
    }
  }
})

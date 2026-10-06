/** Vale's rendering of the base kit and its role mapping: the parts wear the
 * glass the game is painted in (kit/theme.css), and a terminal the same
 * colours, with no game or renderer state imported. */
import { type Colors, type Skin, type Theme } from '@yaks/ui'

export let colors: Colors = {
  bg: '#fbf7ea',
  surface: '#efe6ca',
  card: '#fbf7ea',
  border: '#e2d8bc',
  border2: '#d3c7a4',
  text: '#2f3a2c',
  muted: '#5b6555',
  dim: '#7a8570',
  accent: '#3f6f3a',
  link: '#567bb4',
  heading: '#3f6f3a',
  info: '#567bb4',
  active: '#9a6a1c',
  positive: '#3f8f2a',
  negative: '#c0442a',
  caution: '#9a6a1c',
  special: '#9a3fd6',
  number: '#9a6a1c',
  literal: '#a8492a',
  time: '#567bb4',
  who: '#3f6f3a',
  keyword: '#a8492a',
  string: '#3f6f3a',
  fn: '#567bb4',
  type: '#9a6a1c',
  attr: '#3f6f3a',
  hues: ['#567bb4', '#9a6a1c', '#9a3fd6', '#3f6f3a', '#d9670f', '#a8492a'],
}
export let theme: Theme = {
  css: new URL('./kit/theme.css', import.meta.url),
  colors,
}

// Missing terminal entries keep the base's structural sheet, in Vale colours.
export let skin: Skin = Object.fromEntries(
  [
    'base',
    'Button',
    'Tabs',
    'Head',
    'Section',
    'Body',
    'Tile',
    'Rows',
    'Pairs',
    'Choices',
    'Edit',
    'Field',
    'Panes',
    'Tip',
    'Turns',
  ].map((name) => [name, {
    css: new URL(`./kit/skin/${name}.css`, import.meta.url),
  }]),
)

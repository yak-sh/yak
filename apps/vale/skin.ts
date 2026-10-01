/** Vale's field-book rendering of the base kit and semantic role mapping.
 * Browser tokens retain the existing Vale theme URL; terminal colours are
 * the same current tokens, with no game or renderer state imported. */
import { type Colors, type Skin, type Theme } from '@yaks/ui'

export let colors: Colors = {
  bg: '#efddb5',
  surface: '#d5b989',
  card: '#f9edcf',
  border: '#a9936b',
  border2: '#b28b50',
  text: '#29271e',
  muted: '#665d48',
  dim: '#7a8570',
  accent: '#3f5e35',
  link: '#567bb4',
  heading: '#4c301d',
  info: '#567bb4',
  active: '#9a6a1c',
  positive: '#386f39',
  negative: '#a74832',
  caution: '#9a6a1c',
  special: '#9a3fd6',
  number: '#9a6a1c',
  literal: '#a74832',
  time: '#567bb4',
  who: '#3f5e35',
  keyword: '#a74832',
  string: '#386f39',
  fn: '#567bb4',
  type: '#9a6a1c',
  attr: '#3f5e35',
  hues: ['#567bb4', '#9a6a1c', '#9a3fd6', '#386f39', '#d9670f', '#a74832'],
}
export let theme: Theme = {
  css: new URL('./kit/theme.css', import.meta.url),
  colors,
}

// Missing terminal entries keep the base's structural sheet, in Vale colours.
export let skin: Skin = Object.fromEntries(
  ['Button', 'Tabs', 'Head', 'Tile', 'Edit', 'Panes'].map((name) => [name, {
    css: new URL(`./kit/skin/${name}.css`, import.meta.url),
  }]),
)

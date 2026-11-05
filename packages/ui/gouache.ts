/**
 * Gouache, the default theme: the colours of yak.sh's painted yak,
 * gouache.css for a browser, and its dark scheme (yak.sh's terminal
 * windows) for a terminal.
 *
 * @module
 */

import type { Theme } from './theme.ts'

let teal = '#8cc5c3'
let sienna = '#e5a888'
let bone = '#c4a070'
let slate = '#a19b90'
let cream = '#ece4d4'
let muted = '#cbc4b6'

/** Gouache: yak.sh's sheet in light, its terminal windows in dark. */
export let gouache: Theme = {
  css: new URL('./gouache.css', import.meta.url),
  colors: {
    bg: '#272b35',
    surface: '#33363f',
    card: '#3b3e45',
    border: '#434856',
    border2: '#5e5f62',
    text: cream,
    muted,
    dim: '#96918a',
    accent: teal,
    link: teal,
    heading: cream,
    info: slate,
    active: bone,
    positive: teal,
    negative: sienna,
    caution: sienna,
    special: muted,
    number: bone,
    literal: sienna,
    time: slate,
    who: teal,
    keyword: sienna,
    string: teal,
    fn: '#faf6ee',
    type: bone,
    attr: muted,
    hues: [teal, bone, slate, sienna, muted, '#faf6ee'],
  },
}

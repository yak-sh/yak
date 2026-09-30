/**
 * Everforest, the first theme: everforest.css for a browser, and its dark
 * palette for a terminal.
 *
 * @module
 */

import type { Theme } from './theme.ts'

let red = '#e67e80'
let orange = '#e69875'
let yellow = '#dbbc7f'
let green = '#a7c080'
let blue = '#7fbbb3'
let purple = '#d699b6'

/** Everforest dark (medium). */
export let everforest: Theme = {
  css: new URL('./everforest.css', import.meta.url),
  colors: {
    bg: '#232a2e',
    surface: '#2d353b',
    card: '#343f44',
    border: '#3d484d',
    border2: '#475258',
    text: '#d3c6aa',
    muted: '#9da9a0',
    dim: '#7a8478',
    accent: green,
    link: blue,
    heading: green,
    info: blue,
    active: yellow,
    positive: green,
    negative: red,
    caution: orange,
    special: purple,
    number: purple,
    literal: orange,
    time: blue,
    who: blue,
    keyword: red,
    string: green,
    fn: blue,
    type: yellow,
    attr: orange,
    hues: [blue, yellow, purple, green, orange, red],
  },
}

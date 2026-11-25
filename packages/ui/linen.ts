/**
 * Linen, yaks.app's theme: linen.css for a browser, and its dark scheme (the
 * same room at night) for a terminal.
 *
 * @module
 */

import { beside, type Theme } from './theme.ts'

let at = beside(import.meta.url)

let moss = '#a7c080'
let coral = '#ff6b5e'
let orange = '#ffa057'
let blue = '#8cc0ff'
let raspberry = '#ff8cc0'
let oat = '#f1e6d8'
let taupe = '#c9b19c'

/** Linen: yaks.app's warm sheet in light, the same room at night in dark. */
export let linen: Theme = {
  css: at('./linen.css'),
  colors: {
    bg: '#2b231f',
    surface: '#392d27',
    card: '#372c26',
    border: '#4d3d34',
    border2: '#756255',
    text: oat,
    muted: taupe,
    dim: '#785b47',
    accent: moss,
    link: moss,
    heading: oat,
    info: blue,
    active: orange,
    positive: moss,
    negative: coral,
    caution: coral,
    special: raspberry,
    number: orange,
    literal: coral,
    time: blue,
    who: moss,
    keyword: coral,
    string: moss,
    fn: '#fffbf5',
    type: orange,
    attr: raspberry,
    hues: [moss, orange, blue, coral, raspberry, oat],
  },
}

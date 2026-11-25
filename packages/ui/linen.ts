/**
 * Linen, yaks.app's theme: linen.css for a browser, and its dark scheme (the
 * same room at night) for a terminal.
 *
 * @module
 */

import { beside, type Theme } from './theme.ts'

let at = beside(import.meta.url)

let amber = '#ff9a4d'
let teal = '#4fd1c5'
let green = '#6edc7e'
let saffron = '#ffc23d'
let red = '#ff7272'
let plum = '#e6a3dc'
let rose = '#ff8fb1'
let oat = '#f7ebdc'
let taupe = '#d6b9a0'

/** Linen: yaks.app's warm sheet in light, the same room at night in dark. */
export let linen: Theme = {
  css: at('./linen.css'),
  colors: {
    bg: '#2a1f1b',
    surface: '#382a24',
    card: '#35271f',
    border: '#4f3c32',
    border2: '#7a6151',
    text: oat,
    muted: taupe,
    dim: '#7a6151',
    accent: amber,
    link: teal,
    heading: oat,
    info: plum,
    active: amber,
    positive: green,
    negative: red,
    caution: saffron,
    special: plum,
    number: saffron,
    literal: red,
    time: plum,
    who: teal,
    keyword: red,
    string: green,
    fn: teal,
    type: plum,
    attr: saffron,
    hues: [amber, teal, green, plum, rose, saffron],
  },
}

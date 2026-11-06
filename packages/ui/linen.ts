/**
 * Linen, yaks.app's theme: linen.css for a browser, and its dark scheme (the
 * same room at night) for a terminal.
 *
 * @module
 */

import type { Theme } from './theme.ts'

let moss = '#a7c080'
let rose = '#e67e80'
let sky = '#e5eef5'
let blush = '#f8e0c8'
let oat = '#f1e6d8'
let taupe = '#c9b19c'

/** Linen: yaks.app's warm sheet in light, the same room at night in dark. */
export let linen: Theme = {
  css: new URL('./linen.css', import.meta.url),
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
    info: sky,
    active: blush,
    positive: moss,
    negative: rose,
    caution: rose,
    special: taupe,
    number: blush,
    literal: rose,
    time: sky,
    who: moss,
    keyword: rose,
    string: moss,
    fn: '#fffbf5',
    type: blush,
    attr: taupe,
    hues: [moss, blush, sky, rose, taupe, oat],
  },
}

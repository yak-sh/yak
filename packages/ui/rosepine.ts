/**
 * Rosé Pine, the second theme: rosepine.css for a browser, and its dark
 * palette (Rosé Pine main) for a terminal.
 *
 * @module
 */

import type { Theme } from './theme.ts'

let love = '#eb6f92'
let gold = '#f6c177'
let rose = '#ebbcba'
let pine = '#31748f'
let foam = '#9ccfd8'
let iris = '#c4a7e7'

/** Rosé Pine (main). */
export let rosepine: Theme = {
  css: new URL('./rosepine.css', import.meta.url),
  colors: {
    bg: '#191724',
    surface: '#1f1d2e',
    card: '#26233a',
    border: '#403d52',
    border2: '#524f67',
    text: '#e0def4',
    muted: '#908caa',
    dim: '#6e6a86',
    accent: rose,
    link: iris,
    heading: foam,
    info: foam,
    active: rose,
    positive: pine,
    negative: love,
    caution: gold,
    special: iris,
    number: gold,
    literal: rose,
    time: foam,
    who: iris,
    keyword: pine,
    string: gold,
    fn: rose,
    type: foam,
    attr: iris,
    hues: [foam, gold, iris, pine, rose, love],
  },
}

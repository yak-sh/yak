/**
 * Everforest, the first theme: everforest.css for a browser, and its dark
 * palette for a terminal.
 *
 * @module
 */

import type { Theme } from './theme.ts'

let green = '#a7c080'

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
    green,
    red: '#e67e80',
    orange: '#e69875',
    purple: '#d699b6',
    blue: '#7fbbb3',
    yellow: '#dbbc7f',
    accent: green,
  },
}

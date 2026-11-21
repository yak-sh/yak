/**
 * The picture of something that has none of its own: its first letter in
 * white on a rounded square, as an SVG. The square's colour is picked by
 * `seed` (an eid), so the same thing keeps its colour through a rename and
 * two things beside each other usually differ. Every colour holds white
 * letters at 4.5:1 or better.
 *
 * @module
 */

import { esc } from './escape.ts'

// Inks muted enough to sit on paper and dark enough under a white letter.
let FILLS = [
  '#4a7356', // moss
  '#3d6585', // slate blue
  '#8a5236', // clay
  '#74496e', // plum
  '#8a6422', // ochre
  '#566384', // dusk
  '#8a3f4d', // berry
  '#3f716f', // teal
]

/** The first letter or digit of `name`, as a capital. */
/// letter('book club') -> 'B'
/// letter('  2048') -> '2'
/// letter('—') -> ''
export let letter = (name: string) =>
  (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? '').toLocaleUpperCase()

// A small, steady hash: the same seed always lands on the same colour.
let pick = (seed: string) => {
  let n = 0
  for (let c of seed) n = (n * 31 + c.codePointAt(0)!) >>> 0
  return FILLS[n % FILLS.length]
}

/** The SVG standing for `name`, its colour picked by `seed`. */
export let monogram = (name: string, seed: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
  `<rect width="64" height="64" rx="14" fill="${pick(seed)}"/>` +
  `<text x="32" y="43" fill="#fff" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" ` +
  `font-size="30" font-weight="700" text-anchor="middle">${
    esc(letter(name))
  }</text></svg>`

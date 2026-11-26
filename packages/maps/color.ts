// Colours as a map style needs them: read from `#rgb`, `#rrggbb` or
// `rgb()`/`rgba()`, mixed, and written as `#rrggbb`, which every MapLibre
// version reads. A page resolves a theme's colours to one of these first
// (theme.ts), whatever colour space the theme wrote them in.

/** Red, green and blue, each 0 to 255. */
export type Rgb = [number, number, number]

/** A colour read from hex or `rgb()`, or null for anything else.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { rgb } from '@yaks/maps/color'
 * assertEquals(rgb('#fa0'), [255, 170, 0])
 * assertEquals(rgb('#1e2a3b'), [30, 42, 59])
 * assertEquals(rgb('rgb(1, 2, 3)'), [1, 2, 3])
 * assertEquals(rgb('rgba(1 2 3 / 50%)'), [1, 2, 3])
 * assertEquals(rgb('oklch(0.5 0.1 120)'), null)
 * ```
 */
export let rgb = (color: string): Rgb | null => {
  let c = color.trim().toLowerCase()
  let h = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)?.[1]
  if (h) {
    let full = h.length == 3 ? [...h].map((d) => d + d).join('') : h
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb
  }
  let f = c.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/)
  return f ? [+f[1], +f[2], +f[3]].map(Math.round) as Rgb : null
}

/** A colour written as `#rrggbb`. */
export let hex = ([r, g, b]: Rgb): string =>
  '#' +
  [r, g, b].map((n) =>
    Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  ).join('')

/** `a` moved toward `b` by `t`, 0 to 1, as `#rrggbb`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { mix } from '@yaks/maps/color'
 * assertEquals(mix('#000000', '#ffffff', 0.5), '#808080')
 * assertEquals(mix('#102030', '#102030', 0.3), '#102030')
 * ```
 */
export let mix = (a: string, b: string, t: number): string => {
  let [x, y] = [rgb(a) ?? [0, 0, 0], rgb(b) ?? [0, 0, 0]]
  return hex(x.map((v, i) => v + (y[i] - v) * t) as Rgb)
}

/** How light a colour looks, 0 for black to 1 for white (WCAG relative
 * luminance). */
export let lightness = (color: string): number => {
  let [r, g, b] = (rgb(color) ?? [0, 0, 0]).map((v) => {
    let s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// The theme a map wears, read off the page it is drawn in: each of the
// theme's custom properties (yaks.app `kits`, Colours and type) as the page
// resolves it where the map stands, so `light-dark()`, `oklch()` and
// `color-mix()` arrive as the colour the person sees. A property the page
// leaves unset keeps the plain theme's colour.
import { hex, rgb } from './color.ts'
import { PLAIN, type Theme } from './style.ts'

let NAMES = ['bg', 'surface', 'border', 'text', 'muted', 'accent'] as const

// Any CSS colour as `#rrggbb`: a canvas paints it and the pixel is read.
let pixel = (() => {
  let ctx: CanvasRenderingContext2D | null | undefined
  return (color: string): string | null => {
    let known = rgb(color)
    if (known) return hex(known)
    ctx ??= document.createElement('canvas').getContext('2d', {
      willReadFrequently: true,
    })
    if (!ctx) return null
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    let [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return a ? hex([r, g, b]) : null
  }
})()

/** The theme in force at `where`: each colour resolved as the page draws it
 * there, and the page's own typeface. */
export let themeOf = (where: Element): Theme => {
  let probe = document.createElement('span')
  probe.style.display = 'none'
  where.append(probe)
  try {
    let read = (name: string) => {
      probe.style.color = ''
      probe.style.color = `var(--${name})`
      let said = getComputedStyle(where).getPropertyValue(`--${name}`).trim()
      return said ? pixel(getComputedStyle(probe).color) : null
    }
    let theme = { ...PLAIN }
    for (let name of NAMES) theme[name] = read(name) ?? PLAIN[name]
    let font = getComputedStyle(where).getPropertyValue('--font').trim()
    return font ? { ...theme, font } : theme
  } finally {
    probe.remove()
  }
}

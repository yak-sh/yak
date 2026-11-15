// QR codes for app pages and platform pages, rendered without a DOM or I/O.
import { encode } from 'uqr'
import { esc } from './escape.ts'

/**
 * `text` as an inline SVG, with `label` as its accessible name. Dark modules
 * are drawn as runs in one path; the white quiet zone reads on a dark page.
 *
 * ```ts
 * import { ok } from '@yaks/testing'
 * import { qr } from './qr.ts'
 * let svg = qr('sms:+18885550100?&body=Hi', 'Scan to text')
 * ok(svg.startsWith('<svg') && svg.includes('aria-label="Scan to text"'))
 * ```
 */
export let qr = (text: string, label: string): string => {
  let { data, size } = encode(text, { ecc: 'M', border: 3 })
  let d = data.flatMap((row, y) => {
    let runs: string[] = []
    for (let x = 0; x < size; x++) {
      if (!row[x]) continue
      let n = 1
      while (row[x + n]) n++
      runs.push(`M${x} ${y}h${n}v1h-${n}z`)
      x += n
    }
    return runs
  }).join('')
  return `<svg class="Qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${
    esc(label)
  }" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`
}

#!/usr/bin/env -S deno run -A
// yak.sh's link preview and icon, drawn in this process from its mark and its
// words: og.jpg, the 1200 × 630 picture a pasted yak.sh link shows in
// iMessage, Slack or X, and icon.png, the mark on the site's paper, which is
// also the favicon and the app icon. The icon is opaque, since iOS fills a
// transparent one with black (workers/yak/raster/draw.ts). Both are SVG on the
// site's own paper and washes, drawn by resvg with the site's two fonts. The
// page's grain is left off: it cannot be seen at the size a preview is shown.
// The preview is a JPEG because the painted mark makes a PNG of it half a
// megabyte. Run it after the mark (yak.webp) or the page's headline changes:
//
//   deno run -A bin/yak-sh-preview.ts
//
// The drawings are pure: `og` and `icon` take a mark and return SVG, so the
// mockups of a new mark draw their previews with them too. Only running the
// script reads, fetches and draws.

/** A drawing, and the part of its plane to show as `[x, y, width, height]`. */
export type Mark = { box: number[]; body: string }

// The site's palette, from apps/yak-sh/style.css.
let PAPER = '#f6f1e7', INK = '#2b2b33', SOFT = '#605a55'
let MEADOW = '#1a6f7b', RULE = 'rgba(52,71,77,.2)'

// The page's ground: its paper, with the teal and bone washes the top of the
// page has, teal behind the mark and bone behind the words.
let ground = (w: number, h: number) =>
  `<defs>
<radialGradient id="teal" cx="${w * .74}" cy="${h * .4}" r="${
    w * .5
  }" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${MEADOW}" stop-opacity=".12"/><stop offset=".5" stop-color="${MEADOW}" stop-opacity=".05"/><stop offset="1" stop-color="${MEADOW}" stop-opacity="0"/></radialGradient>
<radialGradient id="bone" cx="${w * .1}" cy="0" r="${
    w * .55
  }" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#c4a070" stop-opacity=".2"/><stop offset=".55" stop-color="#c4a070" stop-opacity=".07"/><stop offset="1" stop-color="#c4a070" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${w}" height="${h}" fill="${PAPER}"/>
<rect width="${w}" height="${h}" fill="url(#bone)"/>
<rect width="${w}" height="${h}" fill="url(#teal)"/>`

let place = (mark: Mark, x: number, y: number, w: number, h: number) =>
  `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${
    mark.box.join(' ')
  }">${mark.body}</svg>`

let esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Words broken into lines of at most `width` characters. */
export let wrap = (words: string, width: number) =>
  words.split(/\s+/).reduce<string[]>((lines, word) => {
    let last = lines[lines.length - 1]
    if (last != null && (last + ' ' + word).length <= width) {
      lines[lines.length - 1] = last + ' ' + word
    } else lines.push(word)
    return lines
  }, [])

/** The 1200 × 630 preview: the site's name, the headline, the kicker, and
 * the mark, on the paper in a drawn frame. */
export let og = (mark: Mark, headline: string, kicker: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
${ground(1200, 630)}
<rect x="28.5" y="28.5" width="1143" height="573" rx="18" fill="none" stroke="${RULE}" stroke-width="1.5"/>
<circle cx="83" cy="84" r="11" fill="${MEADOW}" fill-opacity=".14"/>
<circle cx="83" cy="84" r="6" fill="${MEADOW}"/>
<text x="104" y="94" font-family="Geist Mono" font-weight="500" font-size="28" fill="${INK}">yak.sh</text>
<text font-family="Geist" font-weight="500" font-size="60" letter-spacing="-1.2" fill="${INK}">${
    wrap(headline, 18).map((line, i) =>
      `<tspan x="72" y="${236 + i * 70}">${esc(line)}</tspan>`
    ).join('')
  }</text>
<text x="76" y="550" font-family="Geist Mono" font-size="20" fill="${SOFT}">${
    esc(kicker)
  }</text>
${place(mark, 660, 70, 490, 490)}
</svg>`

/** The square icon: the mark on the paper, edge to edge. */
export let icon = (mark: Mark) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
${ground(192, 192)}
${place(mark, 6, 6, 180, 180)}
</svg>`

// The site's fonts as TrueType, which resvg reads: Google Fonts answers a
// client it does not know as a browser with .ttf files.
let fonts = async () => {
  let css = await (await fetch(
    'https://fonts.googleapis.com/css2?family=Geist:wght@500&family=Geist+Mono:wght@400;500',
  )).text()
  let urls = [...css.matchAll(/url\((https:[^)]+\.ttf)\)/g)].map((m) => m[1])
  if (!urls.length) throw new Error(`no .ttf in Google Fonts' answer: ${css}`)
  return await Promise.all(
    urls.map(async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer())),
  )
}

if (import.meta.main) {
  let { createRequire } = await import('node:module')
  let { initWasm, Resvg } = await import('@resvg/resvg-wasm')
  let { createCanvas, loadImage } = await import('@napi-rs/canvas')
  let { encodeBase64 } = await import('@std/encoding/base64')
  let { parseHTML } = await import('linkedom')
  let app = new URL('../apps/yak-sh/', import.meta.url)
  await initWasm(
    await Deno.readFile(
      createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm'),
    ),
  )
  let fontBuffers = await fonts()
  let draw = (svg: string) =>
    new Resvg(svg, { font: { fontBuffers, defaultFontFamily: 'Geist' } })
      .render().asPng()
  // An image re-encoded through a canvas: resvg reads no WebP, and writes
  // only PNG.
  let encode = async (
    bytes: Uint8Array,
    as: 'png' | 'jpeg',
  ): Promise<Uint8Array> => {
    let image = await loadImage(bytes)
    let canvas = createCanvas(image.width, image.height)
    canvas.getContext('2d').drawImage(image, 0, 0)
    return as == 'png' ? canvas.encode('png') : canvas.encode('jpeg', 84)
  }
  let { document } = parseHTML(
    await Deno.readTextFile(new URL('index.html', app)),
  )
  let text = (selector: string) =>
    document.querySelector(selector)?.textContent?.trim() ?? ''
  let yak = await encode(await Deno.readFile(new URL('yak.webp', app)), 'png')
  let mark = {
    box: [0, 0, 512, 512],
    body: `<image width="512" height="512" href="data:image/png;base64,${
      encodeBase64(yak)
    }"/>`,
  }
  await Deno.writeFile(
    new URL('og.jpg', app),
    await encode(draw(og(mark, text('h1'), text('.Kicker'))), 'jpeg'),
  )
  await Deno.writeFile(new URL('icon.png', app), draw(icon(mark)))
}

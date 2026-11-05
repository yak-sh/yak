#!/usr/bin/env -S deno run -A
// yak.sh's link preview and icon, drawn in this process from its mark and its
// words: og.png, the 1200 × 630 picture a pasted yak.sh link shows in
// iMessage, Slack or X, and icon.png, the mark on the site's paper, which is
// also the favicon. The icon is opaque, since iOS fills a transparent one with
// black (workers/yak/raster/draw.ts). Both are SVG on the site's own paper, its
// colour and its dots, drawn by resvg with the site's two fonts. The page's
// grain is left off: at 6% it cannot be seen at the size a preview is shown,
// and its noise made og.png a megabyte where it is otherwise a quarter of one.
// Run it after the mark (yak.png) or the page's headline changes:
//
//   deno run -A bin/yak-sh-preview.ts
//
// The drawings are pure: `og` and `icon` take a mark and return SVG, so the
// mockups of a new mark draw their previews with them too. Only running the
// script reads, fetches and draws.

/** A drawing, and the part of its plane to show as `[x, y, width, height]`. */
export type Mark = { box: number[]; body: string }

// The site's palette, from apps/yak-sh/style.css.
let PAPER = '#f5f1e8', INK = '#23301f', SOFT = '#5b6753'
let MEADOW = '#4c773e', MOSS = '#a7c080', RULE = 'rgba(54,83,45,.22)'

// The page's ground: its paper, and a dot in every `gap` square (22 px on the
// page).
let ground = (w: number, h: number, gap: number) =>
  `<defs>
<pattern id="dots" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse"><circle cx="${
    gap / 2
  }" cy="${gap / 2}" r="${gap * .053}" fill="rgba(54,83,45,.13)"/></pattern>
<filter id="halo" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="6"/></filter>
</defs>
<rect width="${w}" height="${h}" fill="${PAPER}"/>
<rect width="${w}" height="${h}" fill="url(#dots)"/>`

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

/** The 1200 × 630 preview: the site's name with its lit square, the
 * headline, the kicker, and the mark, on the paper in a drawn frame. */
export let og = (mark: Mark, headline: string, kicker: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
${ground(1200, 630, 22)}
<rect x="28.5" y="28.5" width="1143" height="573" fill="none" stroke="${RULE}" stroke-width="1.5"/>
<rect x="74" y="76" width="16" height="16" fill="${MOSS}" filter="url(#halo)"/>
<rect x="76" y="78" width="12" height="12" fill="${MEADOW}"/>
<text x="104" y="92" font-family="Geist Mono" font-weight="500" font-size="28" fill="${INK}">yak.sh</text>
<text font-family="Geist" font-weight="500" font-size="60" letter-spacing="-1.2" fill="${INK}">${
    wrap(headline, 18).map((line, i) =>
      `<tspan x="72" y="${236 + i * 70}">${esc(line)}</tspan>`
    ).join('')
  }</text>
<text x="76" y="550" font-family="Geist Mono" font-size="20" fill="${SOFT}">${
    esc(kicker)
  }</text>
${place(mark, 660, 70, 480, 490)}
</svg>`

/** The square icon: the mark on the paper, edge to edge. */
export let icon = (mark: Mark) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
${ground(512, 512, 28)}
${place(mark, 24, 24, 464, 464)}
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
  let { document } = parseHTML(
    await Deno.readTextFile(new URL('index.html', app)),
  )
  let text = (selector: string) =>
    document.querySelector(selector)?.textContent?.trim() ?? ''
  let yak = await Deno.readFile(new URL('yak.png', app))
  let mark = {
    box: [0, 0, 512, 512],
    body: `<image width="512" height="512" href="data:image/png;base64,${
      encodeBase64(yak)
    }"/>`,
  }
  await Deno.writeFile(
    new URL('og.png', app),
    draw(og(mark, text('h1'), text('.Kicker'))),
  )
  await Deno.writeFile(new URL('icon.png', app), draw(icon(mark)))
}

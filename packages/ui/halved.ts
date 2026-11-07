/**
 * A sheet's `light-dark()` pairs said again in halves, for a browser that
 * lacks the function (Safari and iOS before 17.5). Such a browser keeps a
 * custom property holding one, then finds it invalid where it is used, so a
 * button filled with `var(--accent)` draws no fill at all. Each rule that
 * pairs a value is followed by the same rule under
 * `@supports not (color: light-dark(#000, #fff))`: its light half, and its
 * dark half under `prefers-color-scheme: dark`.
 *
 * Only the system's scheme turns the halves: a page that forces one with
 * `color-scheme` (the style guide's switch) shows the system's there.
 *
 * @module
 */

let PAIR = 'light-dark('
let LACKING = '@supports not (color: light-dark(#000, #fff))'

// Where the parenthesis at `open` closes, and the first comma inside it.
let span = (s: string, open: number) => {
  let depth = 0, comma = -1
  for (let i = open; i < s.length; i++) {
    if (s[i] == '(') depth++
    else if (s[i] == ',' && depth == 1 && comma < 0) comma = i
    else if (s[i] == ')' && --depth == 0) return { comma, close: i }
  }
  throw new SyntaxError(`an unclosed ${PAIR}) in ${s}`)
}

/** A value with each pair in it taken at its light (0) or dark (1) half. */
/// half('light-dark(#fff, #000)', 0) -> '#fff'
/// half('0 8px light-dark(#5c6a7233, #00000073)', 1) -> '0 8px #00000073'
/// half('light-dark(color-mix(in srgb, red, blue 5%), blue)', 0) -> 'color-mix(in srgb, red, blue 5%)'
/// half('light-dark(#fff, #000) light-dark(#eee, #111)', 1) -> '#000 #111'
export let half = (value: string, side: 0 | 1): string => {
  let at = value.indexOf(PAIR)
  if (at < 0) return value
  let open = at + PAIR.length - 1
  let { comma, close } = span(value, open)
  let taken = side
    ? value.slice(comma + 1, close)
    : value.slice(open + 1, comma)
  return value.slice(0, at) + half(taken.trim(), side) +
    half(value.slice(close + 1), side)
}

// A comment or a string, whose braces and semicolons are not the sheet's.
let QUIET = /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g
let blank = (css: string, kept: (quiet: string) => boolean) =>
  css.replace(QUIET, (m) => kept(m) ? m : ' '.repeat(m.length))

let rule = (selector: string, pairs: string[], side: 0 | 1) =>
  `${selector} {\n${
    pairs.map((d) => {
      let colon = d.indexOf(':')
      return `  ${d.slice(0, colon).trim()}: ${
        half(d.slice(colon + 1).trim(), side)
      };\n`
    }).join('')
  }}`

let fallback = (selector: string, pairs: string[]) =>
  `\n${LACKING} {\n${rule(selector, pairs, 0)}\n` +
  `@media (prefers-color-scheme: dark) {\n${rule(selector, pairs, 1)}\n}\n}`

/** The sheet, each rule that pairs a value followed by its halves, once. */
/// halved(':root { --a: light-dark(#fff, #000); --b: 1px; }') -> ':root { --a: light-dark(#fff, #000); --b: 1px; }\n@supports not (color: light-dark(#000, #fff)) {\n:root {\n  --a: #fff;\n}\n@media (prefers-color-scheme: dark) {\n:root {\n  --a: #000;\n}\n}\n}'
/// halved('/* a light-dark() pair; */ a { color: red }') -> '/* a light-dark() pair; */ a { color: red }'
/// let sheet = 'a { color: light-dark(#111, #eee) }'
/// halved(halved(sheet)) == halved(sheet) -> true
/// halved('@media print { a { color: light-dark(#111, #eee) } }').includes('a {\n  color: #eee;\n}') -> true
export let halved = (css: string): string => {
  // What a declaration says keeps its strings; where its rules fall does not.
  let bare = blank(css, (quiet) => quiet[0] != '/')
  let scan = blank(css, () => false)
  let frames: { selector: string; pairs: string[] }[] = []
  let after: [number, string][] = []
  let start = 0
  for (let i = 0; i < scan.length; i++) {
    let c = scan[i]
    if (c != '{' && c != '}' && c != ';') continue
    let piece = bare.slice(start, i)
    start = i + 1
    if (c == '{') {
      frames.push({ selector: piece.trim(), pairs: [] })
      continue
    }
    let frame = frames.at(-1)
    if (frame && piece.includes(PAIR)) frame.pairs.push(piece)
    if (c != '}') continue
    frames.pop()
    // A rule already followed by its halves, as in a sheet halved before.
    let done = css.startsWith(`\n${LACKING}`, i + 1)
    if (frame?.pairs.length && !frame.selector.startsWith('@') && !done) {
      after.push([i + 1, fallback(frame.selector, frame.pairs)])
    }
  }
  return after.reduceRight(
    (out, [at, text]) => out.slice(0, at) + text + out.slice(at),
    css,
  )
}

// ANSI output rendered as inert Preact nodes. SGR presentation has a faithful
// HTML equivalent; terminal commands and control bytes have none, so they
// disappear rather than reaching the page or becoming visible garbage.

import { Fragment } from 'preact'

type Face = {
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  backgroundColor?: string
}

export type AnsiRun = { text: string; face: Face }

let BASIC = [
  '#4b565c',
  '#e67e80',
  '#a7c080',
  '#dbbc7f',
  '#7fbbb3',
  '#d699b6',
  '#83c092',
  '#d3c6aa',
  '#7a8478',
  '#e67e80',
  '#a7c080',
  '#dbbc7f',
  '#7fbbb3',
  '#d699b6',
  '#83c092',
  '#fff9e8',
]

let color = (n: number) => {
  if (n < 16) return BASIC[n]
  if (n < 232) {
    let i = n - 16
    let part = (x: number) => x ? 55 + x * 40 : 0
    return `rgb(${part(Math.floor(i / 36))}, ${part(Math.floor(i / 6) % 6)}, ${
      part(i % 6)
    })`
  }
  let gray = 8 + (n - 232) * 10
  return `rgb(${gray}, ${gray}, ${gray})`
}

let paint = (face: Face, codes: number[]) => {
  let next = { ...face }
  for (let i = 0; i < codes.length; i++) {
    let n = codes[i]
    if (n == 0) next = {}
    else if (n == 1) next.bold = true
    else if (n == 2) next.dim = true
    else if (n == 3) next.italic = true
    else if (n == 4) next.underline = true
    else if (n == 9) next.strike = true
    else if (n == 22) delete next.bold, delete next.dim
    else if (n == 23) delete next.italic
    else if (n == 24) delete next.underline
    else if (n == 29) delete next.strike
    else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) {
      next.color = BASIC[n < 90 ? n - 30 : n - 82]
    } else if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107)) {
      next.backgroundColor = BASIC[n < 100 ? n - 40 : n - 92]
    } else if (n == 39) delete next.color
    else if (n == 49) delete next.backgroundColor
    else if ((n == 38 || n == 48) && codes[i + 1] == 5) {
      let value = codes[i + 2]
      if (value >= 0 && value <= 255) {
        next[n == 38 ? 'color' : 'backgroundColor'] = color(value)
      }
      i += 2
    } else if ((n == 38 || n == 48) && codes[i + 1] == 2) {
      let rgb = codes.slice(i + 2, i + 5)
      if (rgb.length == 3 && rgb.every((x) => x >= 0 && x <= 255)) {
        next[n == 38 ? 'color' : 'backgroundColor'] = `rgb(${rgb.join(', ')})`
      }
      i += 4
    }
  }
  return next
}

let visible = (text: string) =>
  [...text].filter((x) =>
    x == '\n' || x == '\t' || (x >= ' ' && x < '\x7f') || x > '\x9f'
  ).join('')

export let ansiRuns = (text: string): AnsiRun[] => {
  let out: AnsiRun[] = [], face: Face = {}, at = 0
  let push = (end: number) => {
    let text = visible(textAt(at, end))
    if (text) out.push({ text, face: { ...face } })
  }
  let textAt = (start: number, end: number) => text.slice(start, end)
  for (let i = 0; i < text.length;) {
    if (text[i] != '\x1b') {
      i++
      continue
    }
    push(i)
    if (text[i + 1] == '[') {
      let end = text.slice(i + 2).search(/[\x40-\x7e]/)
      if (end < 0) return out
      end += i + 2
      if (text[end] == 'm') {
        let raw = text.slice(i + 2, end)
        let codes = raw ? raw.split(';').map(Number) : [0]
        if (codes.every(Number.isFinite)) face = paint(face, codes)
      }
      at = i = end + 1
    } else if (text[i + 1] == ']') {
      let rest = text.slice(i + 2)
      let bel = rest.indexOf('\x07')
      let st = rest.indexOf('\x1b\\')
      let end = bel < 0 ? st : st < 0 ? bel : Math.min(bel, st)
      if (end < 0) return out
      at = i = i + 2 + end + (end == st ? 2 : 1)
    } else at = i = Math.min(i + 2, text.length)
  }
  push(text.length)
  return out
}

let classes = (face: Face) =>
  ['bold', 'dim', 'italic', 'underline', 'strike']
    .filter((name) => face[name as keyof Face])
    .map((name) => `Ansi-${name}`).join(' ')

export let Ansi = ({ text }: { text: string }) => (
  <Fragment>
    {ansiRuns(text).map((run, i) => {
      let className = classes(run.face)
      let style = {
        ...run.face.color ? { color: run.face.color } : {},
        ...run.face.backgroundColor
          ? { backgroundColor: run.face.backgroundColor }
          : {},
      }
      return className || style.color || style.backgroundColor
        ? (
          <span key={i} class={className || undefined} style={style}>
            {run.text}
          </span>
        )
        : run.text
    })}
  </Fragment>
)

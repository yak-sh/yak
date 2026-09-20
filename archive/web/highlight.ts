// Code highlighting is one tokenizer with two faces: safe HTML for marked and
// plain segments for the terminal. Highlight.js emits only escaped text and
// spans; parsing that small vocabulary keeps the TUI independent of a DOM.
import hljs from 'highlight.js'

export type Token = { text: string; classes: string[] }
export type Highlight = {
  html: string
  language?: string
  lines: Token[][]
}

let unescape = (s: string) =>
  s.replace(
    /&(?:amp|lt|gt|quot|#(?:x[0-9a-f]+|\d+));/gi,
    (entity) => {
      if (entity == '&amp;') return '&'
      if (entity == '&lt;') return '<'
      if (entity == '&gt;') return '>'
      if (entity == '&quot;') return '"'
      let hex = entity[2].toLowerCase() == 'x'
      let n = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10)
      return String.fromCodePoint(n)
    },
  )

let tokens = (html: string): Token[][] => {
  let lines: Token[][] = [[]]
  let stack: string[][] = []
  let classes: string[] = []
  let parts = html.split(/(<span class="[^"]+">|<\/span>)/)
  for (let part of parts) {
    let open = part.match(/^<span class="([^"]+)">$/)
    if (open) {
      stack.push(classes)
      classes = [...classes, ...open[1].split(/\s+/)]
    } else if (part == '</span>') {
      classes = stack.pop() ?? []
    } else {
      unescape(part).split('\n').forEach((text, i) => {
        if (i) lines.push([])
        if (text) lines[lines.length - 1].push({ text, classes })
      })
    }
  }
  return lines
}

// An explicit but unavailable grammar stays code rather than silently wearing
// a guessed language. An absent info string is the request to detect one.
export let highlight = (text: string, language?: string): Highlight => {
  let asked = language?.trim().split(/\s+/)[0]
  let result = asked && hljs.getLanguage(asked)
    ? hljs.highlight(text, { language: asked, ignoreIllegals: true })
    : asked
    ? { value: hljs.highlight(text, { language: 'plaintext' }).value }
    : hljs.highlightAuto(text)
  return {
    html: result.value,
    language: 'language' in result ? result.language : undefined,
    lines: tokens(result.value),
  }
}

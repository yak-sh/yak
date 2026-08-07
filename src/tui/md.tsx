import { type JSX } from 'preact'
import { highlight, type Token } from '../highlight.ts'
import { commitUrl } from '../md.ts'
import { prefix } from '../types.ts'

// Markdown for the terminal: the tiny common subset parsed into spans the
// sheet knows how to dress — ANSI bold/italic/strike, colored code, and
// OSC 8 hyperlinks (clickable in modern terminals). Line-based blocks,
// regex inlines, no nesting — a task body is prose, not a document.
// Graph ids join the prose here too (md.ts's web rule): a bare T-123 and
// a [written link](T-123) both dress as Md_Ref — recognizable, and the
// id stays visible for the keyboard (no mouse to follow it with).
// Index keys are honest here: the whole frame repaints on any change.
let LETTERS = [...new Set([...Object.values(prefix), 'D'])].join('|')
let RE = new RegExp(
  `(\\*\\*|__)(.+?)\\1|(\\*|_)(.+?)\\3|\`([^\`]+)\`|~~(.+?)~~|` +
    `\\[([^\\]]+)\\]\\(([^)]+)\\)|\\b((?:${LETTERS})-\\d+)\\b`,
)

let inline = (t: string, repo?: string): (string | JSX.Element)[] => {
  let out: (string | JSX.Element)[] = []
  while (t) {
    let m = t.match(RE)
    if (!m || m.index == null) {
      out.push(t)
      break
    }
    if (m.index) out.push(t.slice(0, m.index))
    let k = out.length
    if (m[2]) out.push(<b key={k} class='Md_B'>{m[2]}</b>)
    else if (m[4]) out.push(<span key={k} class='Md_I'>{m[4]}</span>)
    else if (m[5]) {
      let href = commitUrl(repo, m[5])
      out.push(
        href
          ? (
            <a key={k} class='Md_A' href={href}>
              <span class='Md_Code'>{m[5]}</span>
            </a>
          )
          : <span key={k} class='Md_Code'>{m[5]}</span>,
      )
    } else if (m[6]) out.push(<span key={k} class='Md_S'>{m[6]}</span>)
    else if (m[9]) out.push(<span key={k} class='Md_Ref'>{m[9]}</span>)
    else if (/^[A-Za-z]+-\d+$/.test(m[8] ?? '')) {
      // a written link aimed at an id: the words, then the id it means
      out.push(<span key={k} class='Md_Ref'>{m[7]} ({m[8]})</span>)
    } else out.push(<a key={k} class='Md_A' href={m[8]}>{m[7]}</a>)
    t = t.slice(m.index + m[0].length)
  }
  return out
}

export let Md = ({ text, repo }: { text: string; repo?: string }) => {
  let lines = text.split('\n')
  let code = (line: Token[], key: string) => (
    <div key={key} class='Md_Code'>
      {line.map((token, i) => (
        <span key={i} class={token.classes.join(' ')}>{token.text}</span>
      ))}
    </div>
  )
  let out: JSX.Element[] = []
  let fence:
    | { mark: string; size: number; at: number; lang?: string }
    | undefined
  let body: string[] = []
  let flush = (close?: string) => {
    let lit = highlight(body.join('\n'), fence!.lang)
    out.push(
      <div key={`open-${fence!.at}`} class='Md_Fence'>{lines[fence!.at]}</div>,
    )
    lit.lines.forEach((line, i) =>
      out.push(code(line, `code-${fence!.at}-${i}`))
    )
    if (close != null) {
      out.push(
        <div key={`close-${fence!.at}`} class='Md_Fence'>{close}</div>,
      )
    }
    fence = undefined
    body = []
  }
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (fence) {
      let close = line.match(/^ {0,3}(`+|~+)\s*$/)
      if (
        close && close[1][0] == fence.mark && close[1].length >= fence.size
      ) {
        flush(line)
      } else body.push(line)
      continue
    }
    let open = line.match(/^ {0,3}(`{3,}|~{3,})\s*(\S*)?.*$/)
    if (open) {
      fence = {
        mark: open[1][0],
        size: open[1].length,
        at: i,
        lang: open[2] || undefined,
      }
      continue
    }
    let indented = line.match(/^(?: {4}|\t)(.*)$/)
    if (indented) {
      let at = i
      let source = [indented[1]]
      while (i + 1 < lines.length) {
        let next = lines[i + 1].match(/^(?: {4}|\t)(.*)$/)
        if (next) {
          source.push(next[1])
          i++
        } else if (!lines[i + 1].trim()) {
          source.push('')
          i++
        } else break
      }
      highlight(source.join('\n')).lines.forEach((tokens, n) =>
        out.push(code(tokens, `indent-${at}-${n}`))
      )
      continue
    }
    if (!line.trim()) out.push(<div key={i}>&#32;</div>)
    else {
      let h = line.match(/^#+\s+(.*)/)
      let q = line.match(/^>\s?(.*)/)
      let li = line.match(/^\s*[-*]\s+(.*)/)
      if (h) out.push(<div key={i} class='Md_H'>{inline(h[1], repo)}</div>)
      else if (q) {
        out.push(<div key={i} class='Md_Q'>▎ {inline(q[1], repo)}</div>)
      } else if (li) {
        out.push(<div key={i} class='Md_Li'>• {inline(li[1], repo)}</div>)
      } else out.push(<div key={i}>{inline(line, repo)}</div>)
    }
  }
  if (fence) flush()
  return (
    <div class='Md'>
      {out}
    </div>
  )
}

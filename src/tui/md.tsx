import { type JSX } from 'preact'

// Markdown for the terminal: the tiny common subset parsed into spans the
// sheet knows how to dress — ANSI bold/italic/strike, colored code, and
// OSC 8 hyperlinks (clickable in modern terminals). Line-based blocks,
// regex inlines, no nesting — a task body is prose, not a document.
// Index keys are honest here: the whole frame repaints on any change.
let RE =
  /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`|~~(.+?)~~|\[([^\]]+)\]\(([^)]+)\)/

let inline = (t: string): (string | JSX.Element)[] => {
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
    else if (m[5]) out.push(<span key={k} class='Md_Code'>{m[5]}</span>)
    else if (m[6]) out.push(<span key={k} class='Md_S'>{m[6]}</span>)
    else out.push(<a key={k} class='Md_A' href={m[8]}>{m[7]}</a>)
    t = t.slice(m.index + m[0].length)
  }
  return out
}

export let Md = ({ text }: { text: string }) => {
  let fence = false
  return (
    <div class='Md'>
      {text.split('\n').map((line, i) => {
        if (line.trim().startsWith('```')) {
          fence = !fence
          return <div key={i} class='Md_Fence'>{line}</div>
        }
        if (fence) return <div key={i} class='Md_Code'>{line}</div>
        if (!line.trim()) return <div key={i}>&#32;</div> // blank = content
        let h = line.match(/^#+\s+(.*)/)
        if (h) return <div key={i} class='Md_H'>{inline(h[1])}</div>
        let q = line.match(/^>\s?(.*)/)
        if (q) return <div key={i} class='Md_Q'>▎ {inline(q[1])}</div>
        let li = line.match(/^\s*[-*]\s+(.*)/)
        if (li) return <div key={i} class='Md_Li'>• {inline(li[1])}</div>
        return <div key={i}>{inline(line)}</div>
      })}
    </div>
  )
}

// The handout library's logic, with nothing of the page in it: who a handout
// is for, the order the shelf shows, a file's size in words, and a handout's
// text turned into a page.
//
// A handout is `handout{audience, team, file, name, mime, bytes}` with its title
// and text in `doc`. `file` is the eid of the uploaded bytes, read back from
// ./api/blob/<file>; a handout may be text alone, a file alone, or both.

import { esc } from './ui.js'

export let AUDIENCES = ['Athletes', 'Parents', 'Coaches']

export let EVERYTHING = '.handout&?doc&?created&?updated&.limit=2000'

let time = (r) => r.updated?.at ?? r.created?.at ?? ''

/** Newest first, the way a shelf of handouts is read. */
export let newest = (rows) =>
  [...rows].sort((a, b) => time(b).localeCompare(time(a)))

/** The handouts for one audience, or every one when there is none. */
export let forWhom = (rows, audience) =>
  audience ? rows.filter((r) => r.handout.audience == audience) : rows

/** The teams on the shelf, for the team list: each once, by name. */
export let teams = (rows) =>
  [...new Set(rows.map((r) => r.handout.team).filter(Boolean))].sort()

/** 2048 as "2 KB", the way a download button says it. */
export let size = (bytes) => {
  if (!(bytes > 0)) return ''
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** "application/pdf" as "PDF", for the badge beside a file. */
export let kind = (mime, name = '') => {
  let ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toUpperCase()
  if (mime == 'application/pdf') return 'PDF'
  if (mime?.startsWith('image/')) return 'Image'
  return ext || 'File'
}

/** "2026-10-29T…" as "October 29". */
export let day = (iso) => {
  let d = new Date(iso)
  return Number.isNaN(+d)
    ? ''
    : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

// A handout's text as a page: blank lines part paragraphs, a line that starts
// "## " is a heading, and lines that start "- " or "1. " are a list. Nothing
// else is markup, so whatever a coach types reads the way it was typed.
export let page = (text) => {
  let out = []
  let list = null
  let lines = []
  let flush = () => {
    if (lines.length) {
      out.push(`<p class="sheet_Paragraph">${lines.join('<br>')}</p>`)
    }
    if (list) {
      out.push(
        `<${list.tag} class="sheet_List">${list.items.join('')}</${list.tag}>`,
      )
    }
    lines = []
    list = null
  }
  for (let para of String(text ?? '').split(/\n\s*\n/)) {
    for (let line of para.split('\n')) {
      let bullet = /^\s*[-*]\s+(.*)$/.exec(line)
      let number = /^\s*\d+[.)]\s+(.*)$/.exec(line)
      let item = bullet ?? number
      if (item) {
        let tag = bullet ? 'ul' : 'ol'
        if (list?.tag != tag) {
          flush()
          list = { tag, items: [] }
        }
        list.items.push(`<li class="sheet_Item">${esc(item[1])}</li>`)
        continue
      }
      let head = /^##\s+(.*)$/.exec(line.trim())
      if (head || list) flush()
      if (head) out.push(`<h3 class="sheet_Heading">${esc(head[1])}</h3>`)
      else if (line.trim()) lines.push(esc(line.trim()))
    }
    flush()
  }
  return out.join('')
}

/** The first plain sentence of a handout, for its card. */
export let gist = (text, max = 140) => {
  let line = String(text ?? '').split('\n').map((l) => l.trim())
    .find((l) => l && !l.startsWith('##') && !/^[-*\d]/.test(l)) ?? ''
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

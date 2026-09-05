// A letter's body is markdown, and it goes out twice: once as the plain text
// part and once as HTML. This file is both renderings, from one small reader.
//
// It is DELIBERATELY minimal — paragraphs, headings, bullets, links, bold,
// italic, code — because a mail client renders a small subset of HTML anyway
// and because a markdown library is a dependency this package would otherwise
// not need. If you already have a renderer you trust, hand its output in as
// the message's `html` and none of this runs.
//
// Two rules are not negotiable, and they are why this is not `escape()` plus a
// regex:
//
//   MARKUP A BODY WROTE IS TEXT, NEVER MARKUP. Every character a letter
//   carries is escaped; the only tags in the output are the ones this file
//   generates. A letter from a stranger cannot ship a <script> to your reader.
//
//   AN HREF IS TESTED BY ITS SHAPE, NEVER BY A LIST OF BAD SCHEMES. A browser
//   decodes entities inside an attribute, so `javascript&colon;alert(1)` is a
//   scheme by the time it parses one and no denylist sees it coming. Only an
//   absolute http, https, mailto or tel link becomes an anchor; anything else
//   renders as its own words. Relative links are refused too — a mail client
//   has no base document to resolve `/potluck` against, so it would reach the
//   reader as a broken address rather than a link.

/** One piece of a body: a run of words, or the markup that decorates it. */
export type Token = {
  /** what it is */
  kind: 'text' | 'link' | 'code' | 'strong' | 'em'
  /** the words it carries */
  text: string
  /** where a link points */
  href?: string
}

// Links first (their text may hold anything), then code (which consumes its
// content whole), then the two emphases.
let INLINE =
  /\[([^\]]*)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_/g

/** A line of markdown → the tokens it is made of, in order. */
export let tokens = (line: string): Token[] => {
  let out: Token[] = []
  let at = 0
  for (let m of line.matchAll(INLINE)) {
    if (m.index > at) out.push({ kind: 'text', text: line.slice(at, m.index) })
    if (m[2] != null) out.push({ kind: 'link', text: m[1], href: m[2] })
    else if (m[3] != null) out.push({ kind: 'code', text: m[3] })
    else if (m[4] != null) out.push({ kind: 'strong', text: m[4] })
    else out.push({ kind: 'em', text: m[5] ?? m[6] })
    at = m.index + m[0].length
  }
  if (at < line.length) out.push({ kind: 'text', text: line.slice(at) })
  return out
}

/** Whether an href may become an anchor: absolute, and one of four schemes. */
export let linkable = (href: string): boolean =>
  /^(?:https?:\/\/|mailto:|tel:)\S+$/i.test(href.trim())

/** `&` first, or the escapes escape. */
export let escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

let inline = (line: string): string =>
  tokens(line).map((t) =>
    t.kind == 'link' && linkable(t.href!)
      ? `<a href="${escape(t.href!.trim())}">${escape(t.text)}</a>`
      : t.kind == 'code'
      ? `<code>${escape(t.text)}</code>`
      : t.kind == 'strong'
      ? `<strong>${escape(t.text)}</strong>`
      : t.kind == 'em'
      ? `<em>${escape(t.text)}</em>`
      : escape(t.text)
  ).join('')

let flat = (line: string): string =>
  tokens(line).map((t) =>
    t.kind == 'link' && linkable(t.href!) && t.text.trim() != t.href!.trim()
      ? `${t.text} (${t.href!.trim()})`
      : t.text
  ).join('')

// A block is a run of lines between blank ones. Its first line says what it is.
let block = (lines: string[]): string => {
  let head = /^(#{1,6})\s+(.*)$/.exec(lines[0])
  if (head) {
    let n = head[1].length
    return `<h${n}>${inline(head[2])}</h${n}>`
  }
  if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
    let items = lines.map((l) =>
      `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`
    )
    return `<ul>${items.join('')}</ul>`
  }
  return `<p>${lines.map(inline).join('<br>')}</p>`
}

let blocks = (body: string): string[][] =>
  body.replace(/\r\n?/g, '\n').split(/\n\s*\n/)
    .map((b) => b.split('\n').filter((l) => l.trim()))
    .filter((b) => b.length)

/**
 * A markdown body → safe HTML for the message's HTML part. Everything the body
 * wrote is escaped; the only markup in the answer is this file's own.
 *
 * ```ts
 * import { html } from '@yaks/mail'
 * html('Potluck **Friday** — [sign up](https://books.example/potluck)')
 * // '<p>Potluck <strong>Friday</strong> — <a href="…">sign up</a></p>'
 * ```
 */
export let html = (body: string): string => blocks(body).map(block).join('\n')

/**
 * The same body as plain text, for the message's text part: the markup goes,
 * the words stay, and a link keeps its address in parentheses so a reader with
 * no HTML can still follow it.
 */
export let text = (body: string): string =>
  blocks(body).map((lines) =>
    lines.map((l) =>
      flat(l.replace(/^(#{1,6})\s+/, '').replace(/^\s*[-*]\s+/, '- '))
    )
      .join('\n')
  ).join('\n\n')

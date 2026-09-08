/**
 * Serialize a portable tree as Markdown or plain text. Block boundaries are
 * joined locally, rather than normalizing the finished string, because code
 * and explicit breaks must keep the spacing the host supplied. Every literal
 * and destination crosses safe, including the separate code paths.
 */

import type { Child } from '@yaks/render'
import { safe, safeHref } from './safe.ts'
import type { Node } from './tree.ts'

/** The two text presentations supported by this host. */
export type Mode = 'markdown' | 'plain'

type Piece = {
  text: string
  block: boolean
  kind?: 'list' | 'emphasis' | 'code'
}
let blocks = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
  'li',
])
let array = (child: Child<Node>): child is readonly Child<Node>[] =>
  Array.isArray(child)
let element = (child: Child<Node>): child is Node =>
  child != null && typeof child == 'object' && !array(child)
let emphasis = new Set(['strong', 'b', 'em', 'i'])
let known = new Set([
  ...blocks,
  ...emphasis,
  'br',
  'pre',
  'code',
  'ul',
  'ol',
  'a',
  'dl',
  'dt',
  'dd',
])
let heading = (tag: string): boolean => /^h[1-6]$/.test(tag)

// A transparent wrapper must pass its children's boundaries through as well
// as their words; reducing it to one inline string would join two paragraphs.
let flat = (children: readonly Child<Node>[]): Child<Node>[] =>
  children.flatMap((child) => {
    if (array(child)) return flat(child)
    if (element(child) && !known.has(child.tag) && !heading(child.tag)) {
      return flat(child.children)
    }
    return [child]
  })

// Escaping punctuation makes adjacent text leaves literal too: a leaf ending
// in ! beside a link must not silently turn that link into an image.
let escape = (text: string): string =>
  text.replaceAll('&', '&amp;').replace(/[\\`*_[\]{}<>#+.!|~()=\-]/g, '\\$&')

let joined = (pieces: Piece[], mode: Mode, compact = false): string => {
  let out = ''
  let before: Piece | undefined
  for (let piece of pieces) {
    if (!piece.text) continue
    if (out) {
      let separate = mode == 'markdown' && before?.kind &&
        before.kind == piece.kind
      // Markdown otherwise merges independent lists or consumes touching
      // emphasis delimiters. An empty HTML comment expresses that boundary
      // without adding a visible character or changing either element.
      if (before?.block || piece.block) {
        let gap = compact && (before?.kind == 'list' || piece.kind == 'list')
          ? '\n'
          : '\n\n'
        out += separate ? `${gap}<!-- -->${gap}` : gap
      } else if (
        separate &&
        ['*', '`'].some((mark) =>
          out.endsWith(mark) && piece.text.startsWith(mark)
        )
      ) {
        out += '<!-- -->'
      }
    }
    out += piece.text
    before = piece
  }
  return out
}
let children = (node: Node, mode: Mode, compact = false): string =>
  joined(flat(node.children).map((child) => piece(child, mode)), mode, compact)

// Code bypasses Markdown escaping, never content sanitization. br is the
// explicit way to put a newline into a code block under the strict boundary.
let literal = (child: Child<Node>): string => {
  if (array(child)) return child.map(literal).join('')
  if (child == null || typeof child == 'boolean') return ''
  if (!element(child)) return safe(String(child))
  return child.tag == 'br' ? '\n' : child.children.map(literal).join('')
}
let ticks = (text: string, min: number): string => {
  for (let match of text.matchAll(/`+/g)) {
    min = Math.max(min, match[0].length + 1)
  }
  return '`'.repeat(min)
}
let code = (text: string): string => {
  if (!text) return ''
  let mark = ticks(text, 1)
  let pad = text.startsWith('`') || text.endsWith('`') ||
    (text.startsWith(' ') && text.endsWith(' ') && text.trim() != '')
  return `${mark}${pad ? ' ' : ''}${text}${pad ? ' ' : ''}${mark}`
}
let destination = (href: string): string =>
  href.replace(
    /[\\()<>\s]/gu,
    (char) =>
      encodeURIComponent(char).replaceAll('(', '%28').replaceAll(')', '%29'),
  ).replaceAll('&', '&amp;')

let nestedEmphasis = (node: Node): boolean =>
  flat(node.children).some((child) =>
    element(child) && (emphasis.has(child.tag) || nestedEmphasis(child))
  )

let list = (node: Node, mode: Mode): string => {
  let start = Number(node.props?.start ?? 1)
  if (!Number.isSafeInteger(start) || start < 0) start = 1
  let items = flat(node.children).filter((item) =>
    item != null && typeof item != 'boolean' &&
    (element(item) || safe(String(item)).trim() != '')
  )
  return items.map((item, i) => {
    let text = element(item) && item.tag == 'li'
      ? children(item, mode, true)
      : piece(item, mode).text
    let prefix = node.tag == 'ol' ? `${start + i}. ` : '- '
    return prefix + text.replaceAll('\n', `\n${' '.repeat(prefix.length)}`)
  }).join('\n')
}

let definitions = (node: Node, mode: Mode): string => {
  let lines: string[] = []
  let term = false
  for (let item of flat(node.children)) {
    if (element(item) && item.tag == 'div') {
      lines.push(definitions(item, mode))
      term = false
    } else if (element(item) && item.tag == 'dt') {
      lines.push(`${children(item, mode)}:`)
      term = true
    } else {
      let text = piece(item, mode).text
      if (term && element(item) && item.tag == 'dd') {
        lines[lines.length - 1] += ` ${text}`
      } else if (text) lines.push(text)
      term = false
    }
  }
  return lines.join('\n')
}

let piece = (child: Child<Node>, mode: Mode): Piece => {
  if (array(child)) {
    return {
      text: joined(flat(child).map((c) => piece(c, mode)), mode),
      block: false,
    }
  }
  if (child == null || typeof child == 'boolean') {
    return { text: '', block: false }
  }
  if (!element(child)) {
    let text = safe(String(child))
    return { text: mode == 'markdown' ? escape(text) : text, block: false }
  }
  let { tag, props } = child
  let md = mode == 'markdown'
  if (tag == 'br') return { text: md ? '  \n' : '\n', block: false }
  if (tag == 'pre') {
    let text = literal(child)
    let fence = ticks(text, 3)
    let end = text.endsWith('\n') ? '' : '\n'
    return { text: md ? `${fence}\n${text}${end}${fence}` : text, block: true }
  }
  if (tag == 'code') {
    let text = literal(child)
    return { text: md ? code(text) : text, block: false, kind: 'code' }
  }
  if (tag == 'ul' || tag == 'ol') {
    return {
      text: list(child, mode),
      block: true,
      kind: 'list',
    }
  }
  if (tag == 'dl') return { text: definitions(child, mode), block: true }
  let text = children(child, mode)
  if (tag == 'dt') return { text: `${text}: `, block: false }
  if (tag == 'dd') return { text, block: false }
  if (heading(tag)) {
    return {
      text: md ? `${'#'.repeat(Number(tag[1]))} ${text}` : text,
      block: true,
    }
  }
  if (tag == 'a') {
    let href = safeHref(String(props?.href ?? ''))
    if (!href) return { text, block: false }
    if (!text) text = md ? escape(href) : href
    return {
      text: md
        ? `[${text}](${destination(href)})`
        : text == href
        ? text
        : `${text} (${href})`,
      block: false,
    }
  }
  if (md && text && emphasis.has(tag)) {
    // Nested delimiter runs have ambiguous Markdown parses. Inline HTML is
    // Markdown's spelling for the precise nesting; its children remain escaped.
    if (nestedEmphasis(child)) {
      return {
        text: `<${tag}>${text}</${tag}>`,
        block: false,
        kind: 'emphasis',
      }
    }
    let mark = tag == 'strong' || tag == 'b' ? '**' : '*'
    // Whitespace belongs outside the delimiter or CommonMark treats it as
    // literal stars instead of emphasis.
    text = text.replace(
      /^(\s*)([\s\S]*?)(\s*)$/,
      (_all, before, body, after) =>
        body ? `${before}${mark}${body}${mark}${after}` : before + after,
    )
    return { text, block: false, kind: 'emphasis' }
  }
  return { text, block: blocks.has(tag) }
}

/** Serialize one tree without adding a trailing newline. */
export let format = (child: Child<Node>, mode: Mode): string =>
  joined(flat([child]).map((child) => piece(child, mode)), mode)

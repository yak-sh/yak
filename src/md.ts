// The one markdown door. marked (vendored, GFM) replaces snarkdown: real
// <p> paragraphs, tables, strikethrough, task lists, and CommonMark's
// intra-word-underscore rule natively — the two behaviors we'd been
// patching in. breaks:true keeps the comment-app convention: a single
// newline is a line break, like every task tracker people write in.
// Our own data renders unsanitized, the same posture as before.
//
// The graph's ids are part of the prose: a bare T-123 auto-links, and
// [my task idea](T-123) aims a written link at an entity. Both render
// as real anchors carrying data-ref — nav.tsx's delegated listeners give
// them the in-app click (peek/navigate) and entity menu while new-tab forms
// stay native. Code spans and blocks keep ids literal (the tokenizer never
// enters consumed code).
import { marked } from 'marked'
import { prefix } from './types.ts'

// The vendored marked ships no types — the two token shapes we touch.
type RefToken = { id?: unknown }
type LinkToken = { href: string; tokens: unknown }
type Inline = { parser: { parseInline: (t: unknown) => string } }

// Known prefixes only (plus D for docs, the fallback most written
// about) — a boundary-anchored T-123 is a reference, but UTF-8 and
// SHA-256 stay words because their letters sit mid-word.
let LETTERS = [...new Set([...Object.values(prefix), 'D'])].join('|')
let REF = new RegExp(`^(?:${LETTERS})-\\d+\\b`)
let refLink = (id: string, text: string) =>
  `<a href="/${id}" data-ref="${id}">${text}</a>`

marked.use({
  gfm: true,
  breaks: true,
  extensions: [{
    name: 'ref',
    level: 'inline',
    start: (src: string) =>
      src.match(new RegExp(`\\b(?:${LETTERS})-\\d`))?.index,
    tokenizer(src: string) {
      let m = REF.exec(src)
      if (m) return { type: 'ref', raw: m[0], id: m[0] }
    },
    renderer: (t: RefToken) => refLink(String(t.id), String(t.id)),
  }],
  renderer: {
    // A written link aimed at an id gets the same in-app anchor; every
    // other link keeps marked's own rendering.
    link(this: Inline, token: LinkToken) {
      if (/^[A-Za-z]+-\d+$/.test(token.href)) {
        return refLink(token.href, this.parser.parseInline(token.tokens))
      }
      return false
    },
  },
})

export let md = (s: string): string => marked.parse(s) as string

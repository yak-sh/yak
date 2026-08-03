// The one markdown door. marked (vendored, GFM) replaces snarkdown: real
// <p> paragraphs, tables, strikethrough, task lists, and CommonMark's
// intra-word-underscore rule natively — the two behaviors we'd been
// patching in. breaks:true keeps the comment-app convention: a single
// newline is a line break, like every task tracker people write in.
//
// A body is UNTRUSTED and this string goes straight to innerHTML.
// "Our own data" stopped being true when the fleet took public mail:
// inbound.ts turns a letter from anyone on the internet into a doc body,
// and the canvas is same-origin to /apply and /ws, which have no auth.
// So markup written INSIDE a body never becomes markup — an html token
// renders as its own escaped text, and only an href that cannot carry a
// scheme stays a link. What the door GENERATES is ours and untouched:
// the ref anchors below, code spans, tables, task lists. (T-12814; the
// TUI's half of the same class is tui/paint.ts.)
//
// The graph's ids are part of the prose: a bare T-123 auto-links, and
// [my task idea](T-123) aims a written link at an entity. Both render
// as real anchors carrying data-ref — nav.tsx's delegated listeners give
// them the in-app click (peek/navigate) and entity menu while new-tab forms
// stay native. Code spans and blocks keep ids literal (the tokenizer never
// enters consumed code).
//
// The door comes in two: `md` for the canvas, `mdAbs` for a reader with
// no base document to resolve `/T-123` against — an email client turns
// that into `http:///T-123` (T-12558). Same parse, same everything, one
// difference (how a ref becomes an href), so neither can drift.
import { Marked } from 'marked'
import { prefix } from './types.ts'
import { entityUrl } from './url.ts'

// The vendored marked ships no types — the token shapes we touch.
type RefToken = { id?: unknown }
type LinkToken = { href: string; tokens: unknown }
type ImageToken = { href: string; text: string }
type TextToken = { text: string }
type Inline = { parser: { parseInline: (t: unknown) => string } }

// `&` first, or the escapes escape.
let esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// An href is content too, so it gets a SHAPE test rather than a list of
// forbidden schemes: a browser decodes entities inside an attribute, so
// `javascript&colon;alert(1)` is a scheme by the time it parses one, and
// no denylist of literal `javascript:` sees it coming. http(s), mailto,
// tel and anything relative pass; everything else renders as its words,
// which is already what marked does for a url it cannot clean.
let LINKABLE = /^(?:https?:\/\/|mailto:|tel:|[/#?]|[\w.-]+(?:[/#?]|$))/i

// Known prefixes only (plus D for docs, the fallback most written
// about) — a boundary-anchored T-123 is a reference, but UTF-8 and
// SHA-256 stay words because their letters sit mid-word.
let LETTERS = [...new Set([...Object.values(prefix), 'D'])].join('|')
let REF = new RegExp(`^(?:${LETTERS})-\\d+\\b`)

type Ref = (id: string, text: string) => string

let door = (ref: Ref) =>
  new Marked({
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
      renderer: (t: RefToken) => ref(String(t.id), String(t.id)),
    }],
    renderer: {
      // Markup a body wrote is text, not markup — block and inline alike
      // arrive as this one token.
      html: (t: TextToken) => esc(t.text),
      // A written link aimed at an id gets the same anchor as a bare one;
      // every other link keeps marked's own rendering, unless its href
      // couldn't be an href — then the words stay, the trap goes.
      link(this: Inline, token: LinkToken) {
        if (/^[A-Za-z]+-\d+$/.test(token.href)) {
          return ref(token.href, this.parser.parseInline(token.tokens))
        }
        if (!LINKABLE.test(token.href.trim())) {
          return this.parser.parseInline(token.tokens)
        }
        return false
      },
      // Same rule for a src; an image we refuse shows its alt text.
      image: (t: ImageToken) =>
        LINKABLE.test(t.href.trim()) ? false : esc(t.text),
    },
  })

let canvas = door((id, text) => `<a href="/${id}" data-ref="${id}">${text}</a>`)

// Away from the canvas data-ref has nothing to bind to — the delegated
// listeners aren't there — so the anchor sheds it rather than mailing
// inert markup out.
let away = door((id, text) => `<a href="${entityUrl(id)}">${text}</a>`)

export let md = (s: string): string => canvas.parse(s) as string
export let mdAbs = (s: string): string => away.parse(s) as string

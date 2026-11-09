/** Markdown as structural nodes, never generated HTML or terminal escapes.
 * Uses the same GFM parser/version as the older canvas markdown renderer.
 */
import { Lexer, type Token, type Tokens } from 'marked'
import type { Child, H } from '@yaks/render'

export { type Token } from 'marked'

/** Parse GFM. `breaks` turns a single newline into a line break, which is what
 * a chat message or a terminal line wants and what a document does not: prose
 * wrapped at 80 columns would keep every one of those wraps. */
export let parse = (
  source: string,
  { breaks = true }: { breaks?: boolean } = {},
): Token[] => Lexer.lex(source, { gfm: true, breaks })

/** Parse a line of GFM, such as a label or a title: its inline markup only,
 * with no paragraph around it. */
export let parseInline = (source: string): Token[] =>
  Lexer.lexInline(source, { gfm: true })

/** The words a heading is made of, with the markup dropped: a reader sees
 * these words, so the anchor is named after them. */
let words = (tokens: Token[]): string =>
  tokens.map((t) => {
    let inner = (t as { tokens?: Token[] }).tokens
    return inner ? words(inner) : (t as { text?: string }).text ?? ''
  }).join('')

/** A document's anchor names, handed out in reading order: lowercase words
 * joined by hyphens, everything that is not a letter or a number dropped — so
 * a name can never carry a quote or an angle bracket into an attribute — and
 * a number on any name the document says twice. */
export let slugs = (): (text: string) => string => {
  let seen = new Map<string, number>()
  return (text) => {
    let base = text.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').trim()
      .replace(/\s+/g, '-') || 'section'
    let n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n > 1 ? `${base}-${n}` : base
  }
}

/** Every heading of a document in reading order, each under the id `render`
 * gives it — which is how a contents list links what is on the page without
 * drawing the page a second time. */
export let headings = (
  tokens: Token[],
): { depth: number; text: string; id: string }[] => {
  let name = slugs()
  let found = (
    items: Token[],
  ): { depth: number; text: string; id: string }[] =>
    items.flatMap((t) => {
      if (t.type == 'heading') {
        let text = words((t as Tokens.Heading).tokens)
        return [{ depth: (t as Tokens.Heading).depth, text, id: name(text) }]
      }
      let inner = (t as { tokens?: Token[] }).tokens
      return inner ? found(inner) : []
    })
  return found(tokens)
}

/** Only navigable links: no scripting, data, or control-byte URL schemes. */
export let safeHref = (href: string): string | undefined => {
  if ([...href].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) == 127)) {
    return undefined
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^(https?:|mailto:)/i.test(href)) {
    return undefined
  }
  return href
}

let parts: Record<string, string> = {
  p: 'Paragraph',
  h1: 'Heading',
  h2: 'Heading',
  h3: 'Heading',
  h4: 'Heading',
  h5: 'Heading',
  h6: 'Heading',
  strong: 'Strong',
  em: 'Emphasis',
  del: 'Deleted',
  code: 'Code',
  pre: 'Source',
  br: 'Break',
  hr: 'Rule',
  blockquote: 'Quote',
  ol: 'Ordered',
  ul: 'Unordered',
  li: 'Item',
  a: 'Link',
  table: 'Table',
  thead: 'Head',
  tbody: 'Rows',
  tr: 'Row',
  th: 'HeadingCell',
  td: 'Cell',
}

let bodyClass = (tag: string) =>
  `Body_${parts[tag]}` +
  (/^h[1-6]$/.test(tag) ? ` Body_Heading-${tag.slice(1)}` : '')

/** The same semantic elements can be used outside a Markdown document. */
/** The parsed tree's blocks through any @yaks/render host (including
 * Preact), for a caller that holds them in an element of its own, such as a
 * page's `Body`. HTML tokens remain text. Images are descriptive links, never
 * remote fetches.
 */
export let blocks = <Node>(tokens: Token[], host: H<Node>): Child<Node>[] => {
  let name = slugs()
  let element = (
    tag: string,
    props: Record<string, unknown> | null,
    ...children: Child<Node>[]
  ) => {
    return host(tag, {
      ...props,
      class: [
        bodyClass(tag),
        props?.class,
      ].filter(Boolean).join(' '),
    }, ...children)
  }
  let children = (items: Token[]): Child<Node>[] => items.flatMap(token)
  let token = (t: Token): Child<Node>[] => {
    switch (t.type) {
      case 'space':
        return []
      case 'paragraph':
        return [element('p', null, ...children((t as Tokens.Paragraph).tokens))]
      case 'heading': {
        let v = t as Tokens.Heading
        // The id is the anchor a contents list points at (`headings` hands
        // out the same names in the same order), so every consumer of a
        // document gets headings it can link to.
        let at = { id: name(words(v.tokens)) }
        return [element('h' + v.depth, at, ...children(v.tokens))]
      }
      case 'strong':
        return [
          element('strong', null, ...children((t as Tokens.Strong).tokens)),
        ]
      case 'em':
        return [element('em', null, ...children((t as Tokens.Em).tokens))]
      case 'del':
        return [element('del', null, ...children((t as Tokens.Del).tokens))]
      case 'codespan':
        return [element('code', null, (t as Tokens.Codespan).text)]
      case 'code': {
        let v = t as Tokens.Code
        return [
          element(
            'pre',
            null,
            element('code', {
              class: v.lang ? 'language-' + v.lang.split(/\s/)[0] : undefined,
            }, v.text),
          ),
        ]
      }
      case 'br':
        return [element('br', null)]
      case 'hr':
        return [element('hr', null)]
      case 'blockquote':
        return [
          element(
            'blockquote',
            null,
            ...children((t as Tokens.Blockquote).tokens),
          ),
        ]
      case 'list': {
        let v = t as Tokens.List
        return [
          element(
            v.ordered ? 'ol' : 'ul',
            { start: v.ordered ? v.start : undefined },
            ...v.items.map((item, i) =>
              element(
                'li',
                {
                  'data-marker': v.ordered
                    ? String(Number(v.start) + i) + '. '
                    : '• ',
                },
                item.task ? (item.checked ? '[x] ' : '[ ] ') : '',
                ...children(item.tokens),
              )
            ),
          ),
        ]
      }
      case 'link': {
        let v = t as Tokens.Link
        return [
          element(
            'a',
            { href: safeHref(v.href), title: v.title },
            ...children(v.tokens),
          ),
        ]
      }
      case 'image': {
        let v = t as Tokens.Image
        return [
          element(
            'a',
            { href: safeHref(v.href), title: v.title },
            v.text || '[image]',
          ),
        ]
      }
      case 'table': {
        let v = t as Tokens.Table
        return [
          element(
            'table',
            null,
            element(
              'thead',
              null,
              element(
                'tr',
                null,
                ...v.header.map((cell, col) =>
                  element(
                    'th',
                    { align: v.align[col] ?? undefined },
                    ...children(cell.tokens),
                  )
                ),
              ),
            ),
            element(
              'tbody',
              null,
              ...v.rows.map((row) =>
                element(
                  'tr',
                  null,
                  ...row.map((cell, col) =>
                    element(
                      'td',
                      { align: v.align[col] ?? undefined },
                      ...children(cell.tokens),
                    )
                  ),
                )
              ),
            ),
          ),
        ]
      }
      case 'text': {
        // A soft line break, kept as a newline when `breaks` is off, is a
        // space in Markdown. Left as a newline, a terminal would break the
        // line there, and a renderer that joins wrapped rows would run its
        // two words together.
        let v = t as Tokens.Text
        return v.tokens ? children(v.tokens) : [v.text.replace(/ *\n */g, ' ')]
      }
      case 'escape':
        return [(t as Tokens.Escape).text]
      case 'html': {
        // Markup is text here, never markup. A comment is not even that: it
        // is the author writing to whoever opens the file, which every other
        // renderer drops and this one used to paint as words on the page.
        let { text } = t as Tokens.HTML
        return /^\s*<!--[\s\S]*-->\s*$/.test(text) ? [] : [text]
      }
      default:
        return [t.raw]
    }
  }
  return children(tokens)
}

/** Render the parsed tree through any @yaks/render host: its blocks, in the
 * document's own element. */
export let render = <Node>(tokens: Token[], host: H<Node>): Node =>
  host('div', { class: 'Markdown', wrap: '1' }, ...blocks(tokens, host))

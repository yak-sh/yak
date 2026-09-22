/** Markdown as structural nodes, never generated HTML or terminal escapes.
 * Uses the same GFM parser/version as the older canvas markdown renderer.
 */
import { Lexer, type Token, type Tokens } from 'marked'
import { type ComponentChildren, h, type VNode } from 'preact'
import type { Child, H } from '@yaks/render'

export { type Token } from 'marked'

/** Parse GFM. `breaks` turns a single newline into a line break, which is what
 * a chat message or a terminal line wants and what a document does not: prose
 * wrapped at 80 columns would keep every one of those wraps. */
export let parse = (
  source: string,
  { breaks = true }: { breaks?: boolean } = {},
): Token[] => Lexer.lex(source, { gfm: true, breaks })

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

/** The same semantic elements can be used outside a Markdown document. */
type Props = { children?: ComponentChildren }
export let Bold = ({ children }: Props): VNode => h('strong', null, children)
export let Italic = ({ children }: Props): VNode => h('em', null, children)
export let Heading = (
  { level = 1, children }: Props & { level?: number },
): VNode =>
  h<object>('h' + Math.max(1, Math.min(6, Math.trunc(level))), null, children)
export let Code = ({ children }: Props): VNode => h('code', null, children)
export let CodeBlock = (
  { children, language }: Props & { language?: string },
): VNode =>
  h(
    'pre',
    null,
    h(
      'code',
      { class: language ? 'language-' + language : undefined },
      children,
    ),
  )
export let Link = (
  { href, children }: Props & { href: string },
): VNode<{ href: string | undefined }> =>
  h<{ href: string | undefined }>('a', { href: safeHref(href) }, children)

/** Render the parsed tree through any @yaks/render host (including Preact).
 * HTML tokens remain text. Images are descriptive links, never remote fetches.
 */
export let render = <Node>(tokens: Token[], host: H<Node>): Node => {
  let name = slugs()
  let children = (items: Token[]): Child<Node>[] => items.flatMap(token)
  let token = (t: Token): Child<Node>[] => {
    switch (t.type) {
      case 'space':
        return []
      case 'paragraph':
        return [host('p', null, ...children((t as Tokens.Paragraph).tokens))]
      case 'heading': {
        let v = t as Tokens.Heading
        // The id is the anchor a contents list points at (`headings` hands
        // out the same names in the same order), so every consumer of a
        // document gets headings it can link to.
        let at = { id: name(words(v.tokens)) }
        return [host('h' + v.depth, at, ...children(v.tokens))]
      }
      case 'strong':
        return [host('strong', null, ...children((t as Tokens.Strong).tokens))]
      case 'em':
        return [host('em', null, ...children((t as Tokens.Em).tokens))]
      case 'del':
        return [host('del', null, ...children((t as Tokens.Del).tokens))]
      case 'codespan':
        return [host('code', null, (t as Tokens.Codespan).text)]
      case 'code': {
        let v = t as Tokens.Code
        return [
          host(
            'pre',
            null,
            host('code', {
              class: v.lang ? 'language-' + v.lang.split(/\s/)[0] : undefined,
            }, v.text),
          ),
        ]
      }
      case 'br':
        return [host('br', null)]
      case 'hr':
        return [host('hr', null)]
      case 'blockquote':
        return [
          host(
            'blockquote',
            null,
            ...children((t as Tokens.Blockquote).tokens),
          ),
        ]
      case 'list': {
        let v = t as Tokens.List
        return [
          host(
            v.ordered ? 'ol' : 'ul',
            { start: v.ordered ? v.start : undefined },
            ...v.items.map((item, i) =>
              host(
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
          host(
            'a',
            { href: safeHref(v.href), title: v.title },
            ...children(v.tokens),
          ),
        ]
      }
      case 'image': {
        let v = t as Tokens.Image
        return [
          host(
            'a',
            { href: safeHref(v.href), title: v.title },
            v.text || '[image]',
          ),
        ]
      }
      case 'table': {
        let v = t as Tokens.Table
        return [
          host(
            'table',
            null,
            host(
              'thead',
              null,
              host(
                'tr',
                null,
                ...v.header.map((cell, col) =>
                  host(
                    'th',
                    { align: v.align[col] ?? undefined },
                    ...children(cell.tokens),
                  )
                ),
              ),
            ),
            host(
              'tbody',
              null,
              ...v.rows.map((row) =>
                host(
                  'tr',
                  null,
                  ...row.map((cell, col) =>
                    host(
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
        let v = t as Tokens.Text
        return v.tokens ? children(v.tokens) : [v.text]
      }
      case 'escape':
        return [(t as Tokens.Escape).text]
      case 'html':
        return [(t as Tokens.HTML).text]
      default:
        return [t.raw]
    }
  }
  return host('div', { class: 'Markdown', wrap: '1' }, ...children(tokens))
}

/** Preact component shared by browser DOM and the terminal's Preact DOM. */
export let Markdown = ({ source }: { source: string }): VNode =>
  render(parse(source), h as H<ReturnType<typeof h>>)

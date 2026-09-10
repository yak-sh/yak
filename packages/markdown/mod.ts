/** Markdown as structural nodes, never generated HTML or terminal escapes.
 * Uses the same GFM parser/version as the older canvas markdown renderer.
 */
import { Lexer, type Token, type Tokens } from 'marked'
import { type ComponentChildren, h, type VNode } from 'preact'
import type { Child, H } from '@yaks/render'

export { type Token } from 'marked'
export let parse = (source: string): Token[] =>
  Lexer.lex(source, { gfm: true, breaks: true })

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
  let children = (items: Token[]): Child<Node>[] => items.flatMap(token)
  let token = (t: Token): Child<Node>[] => {
    switch (t.type) {
      case 'space':
        return []
      case 'paragraph':
        return [host('p', null, ...children((t as Tokens.Paragraph).tokens))]
      case 'heading': {
        let v = t as Tokens.Heading
        return [host('h' + v.depth, null, ...children(v.tokens))]
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
                ...v.header.map((cell) =>
                  host('th', null, ...children(cell.tokens))
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
                  ...row.map((cell) =>
                    host('td', null, ...children(cell.tokens))
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

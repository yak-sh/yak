// The page's words: each mention of yaks.app in its prose, titles and
// captions is a link to yaks.app that opens in a new tab. Code and terminal
// lines keep theirs as typed, where a link would break the command.
import { h } from 'preact'
import { parse, render, type Token } from '@yaks/markdown'
import type { H } from '@yaks/render'

export const YAKS_APP = 'https://yaks.app'

// yaks.app as a word of its own: not the end of a longer name such as
// yourname.yaks.app, nor the start of a path or another word.
let MENTION = /(?<![\w.-])yaks\.app(?![\w/-]|\.\w)/

// A link to yaks.app opens in a new tab, so the reader keeps their place.
const AWAY = { target: '_blank', rel: 'noopener' }
let away = (href?: string) =>
  href == YAKS_APP || href?.startsWith(`${YAKS_APP}/`) ? AWAY : {}

/** A line of text with each mention of yaks.app a link to it. */
export let words = (line: string) =>
  line.split(MENTION).flatMap((part, i) => [
    ...i ? [h('a', { href: YAKS_APP, ...AWAY }, 'yaks.app')] : [],
    ...part ? [part] : [],
  ])

let link = (text: string): Token => ({
  type: 'link',
  raw: text,
  href: YAKS_APP,
  title: null,
  text,
  tokens: [{ type: 'text', raw: text, text }],
})

// The tokens with each mention in their text a link, leaving code and the
// words of links as they are.
let linked = (tokens: Token[]): Token[] =>
  tokens.flatMap((t): Token[] => {
    if (t.type == 'link' || t.type == 'codespan' || t.type == 'code') return [t]
    if (t.type == 'list') {
      return [{
        ...t,
        items: t.items.map((i: { tokens: Token[] }) => ({
          ...i,
          tokens: linked(i.tokens),
        })),
      }]
    }
    if ('tokens' in t && t.tokens) return [{ ...t, tokens: linked(t.tokens) }]
    if (t.type != 'text') return [t]
    return t.text.split(MENTION).flatMap((part: string, i: number) => [
      ...i ? [link('yaks.app')] : [],
      ...part ? [{ type: 'text', raw: part, text: part } as Token] : [],
    ])
  })

let host = ((tag: string, props: Record<string, unknown> | null, ...kids) =>
  h(
    tag,
    tag == 'a' ? { ...props, ...away(props?.href as string) } : props,
    ...kids,
  )) as H<ReturnType<typeof h>>

/** Markdown, as @yaks/markdown draws it, with each mention of yaks.app a
 * link to it. */
export let Prose = ({ source }: { source: string }) =>
  render(linked(parse(source)), host)

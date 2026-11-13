// Preact components over the shared structural Markdown renderer.
import {
  type ComponentChildren,
  type Context,
  createContext,
  h,
  type VNode,
} from 'preact'
import { useContext } from 'preact/hooks'
import type { H } from '@yaks/render'
import {
  blocks,
  type Options,
  parse,
  parseInline,
  render,
  safeHref,
} from './structural.ts'
export * from './structural.ts'

type Props = { children?: ComponentChildren }
export let Bold = ({ children }: Props): VNode<{ class?: string }> =>
  h<{ class?: string }>('strong', { class: 'Body_Strong' }, children)
export let Italic = ({ children }: Props): VNode<{ class?: string }> =>
  h<{ class?: string }>('em', { class: 'Body_Emphasis' }, children)
export let Heading = (
  { level = 1, children }: Props & { level?: number },
): VNode<{ class?: string }> =>
  h<{ class?: string }>('h' + Math.max(1, Math.min(6, Math.trunc(level))), {
    class: `Body_Heading Body_Heading-${
      Math.max(1, Math.min(6, Math.trunc(level)))
    }`,
  }, children)
export let Code = ({ children }: Props): VNode<{ class?: string }> =>
  h<{ class?: string }>('code', { class: 'Body_Code' }, children)
export let CodeBlock = (
  { children, language }: Props & { language?: string },
): VNode<{ class?: string }> =>
  h<{ class?: string }>(
    'pre',
    { class: 'Body_Source' },
    h(
      'code',
      { class: 'Body_Code' + (language ? ' language-' + language : '') },
      children,
    ),
  )
export let Link = (
  { href, children }: Props & { href: string },
): VNode<{ href: string | undefined; class: string }> =>
  h<{ href: string | undefined; class: string }>('a', {
    href: safeHref(href),
    class: 'Body_Link',
  }, children)

/** What the host gives every `Markdown` beneath it: where an entity id leads
 * for this reader, and how code is coloured. The browse app gives its own
 * routes; a page whose reader cannot open entities gives none, and ids stay
 * words. */
export let Host: Context<Options> = createContext<Options>({})

/** Preact component shared by browser DOM and the terminal's Preact DOM.
 * `breaks: false` reads a document whose prose wraps across source lines. */
export let Markdown = (
  { source, breaks }: { source: string; breaks?: boolean },
): VNode =>
  render(
    parse(source, { breaks }),
    h as H<ReturnType<typeof h>>,
    useContext(Host),
  )

/** A line of Markdown in the line it stands in, such as a label in a button:
 * its inline markup, in a `span`. Its ids stay words, since the line it
 * stands in is usually itself the thing pressed; `flat` makes its links and
 * images words too, for a line that is itself a link, such as a title. */
export let MarkdownInline = (
  { source, flat }: { source: string; flat?: boolean },
): VNode =>
  h('span', null, ...blocks(parseInline(source), h as H<VNode>, { flat }))

// Preact components over the shared structural Markdown renderer.
import { type ComponentChildren, h, type VNode } from 'preact'
import type { H } from '@yaks/render'
import { blocks, parse, parseInline, render, safeHref } from './structural.ts'
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

/** Preact component shared by browser DOM and the terminal's Preact DOM. */
export let Markdown = (
  { source }: { source: string },
): VNode => render(parse(source), h as H<ReturnType<typeof h>>)

/** A line of Markdown in the line it stands in, such as a label in a button:
 * its inline markup, in a `span`. */
export let MarkdownInline = (
  { source }: { source: string },
): VNode => h('span', null, ...blocks(parseInline(source), h as H<VNode>))

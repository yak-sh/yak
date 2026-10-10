// Preact components over the shared structural Markdown renderer.
import { type ComponentChildren, h, type VNode } from 'preact'
import type { H } from '@yaks/render'
import { parse, render, safeHref } from './structural.ts'
export * from './structural.ts'

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

/** Preact component shared by browser DOM and the terminal's Preact DOM. */
export let Markdown = ({ source }: { source: string }): VNode =>
  render(parse(source), h as H<ReturnType<typeof h>>)

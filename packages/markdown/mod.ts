// React components over the shared structural Markdown renderer.
import {
  type Context,
  createContext,
  createElement as h,
  type ReactElement,
  type ReactNode,
  useContext,
} from 'react'
import type { H } from '@yaks/render'
import {
  blocks,
  type Options,
  parse,
  parseInline,
  render,
  safeHref,
} from './structural.ts'
import { away } from './away.ts'
import { Site } from './site.ts'
export * from './structural.ts'
export { Site }

type Props = { children?: ReactNode }
export let Bold = ({ children }: Props): ReactElement<{ className?: string }> =>
  h<{ className?: string }>('strong', { className: 'Body_Strong' }, children)
export let Italic = (
  { children }: Props,
): ReactElement<{ className?: string }> =>
  h<{ className?: string }>('em', { className: 'Body_Emphasis' }, children)
export let Heading = (
  { level = 1, children }: Props & { level?: number },
): ReactElement<{ className?: string }> =>
  h<{ className?: string }>('h' + Math.max(1, Math.min(6, Math.trunc(level))), {
    className: `Body_Heading Body_Heading-${
      Math.max(1, Math.min(6, Math.trunc(level)))
    }`,
  }, children)
export let Code = ({ children }: Props): ReactElement<{ className?: string }> =>
  h<{ className?: string }>('code', { className: 'Body_Code' }, children)
export let CodeBlock = (
  { children, language }: Props & { language?: string },
): ReactElement<{ className?: string }> =>
  h<{ className?: string }>(
    'pre',
    { className: 'Body_Source' },
    h(
      'code',
      { className: 'Body_Code' + (language ? ' language-' + language : '') },
      children,
    ),
  )
export let Link = (
  { href, children }: Props & { href: string },
): ReactElement<{ href: string | undefined; className: string }> =>
  h(
    'a',
    away({ href: safeHref(href), className: 'Body_Link' }, useHost().site),
    children,
  )

/** What the host gives every `Markdown` beneath it: where an entity id leads
 * for this reader, and how code is coloured. The browse app gives its own
 * routes; a page whose reader cannot open entities gives none, and ids stay
 * words. */
export let Host: Context<Options> = createContext<Options>({})

/** The host's options as a component beneath it draws with them: `Host`'s,
 * with the page's `Site` where one is given. */
export let useHost = (): Options => {
  let host = useContext(Host)
  let site = useContext(Site) ?? host.site
  return site ? { ...host, site } : host
}

let node: H<ReactElement> = (tag, props, ...children) => {
  if (!props || !('class' in props)) return h(tag, props, ...children)
  let { class: className, ...attributes } = props
  return h<{ className?: unknown }>(
    tag,
    { ...attributes, className },
    ...children,
  )
}

/** `breaks: false` reads a document whose prose wraps across source lines. */
export let Markdown = (
  { source, breaks }: { source: string; breaks?: boolean },
): ReactElement =>
  render(
    parse(source, { breaks }),
    node,
    useHost(),
  )

/** A line of Markdown in the line it stands in, such as a label in a button:
 * its inline markup, in a `span`. Its ids stay words, since the line it
 * stands in is usually itself the thing pressed; `flat` makes its links and
 * images words too, for a line that is itself a link, such as a title. */
export let MarkdownInline = (
  { source, flat }: { source: string; flat?: boolean },
): ReactElement =>
  h(
    'span',
    null,
    ...blocks(parseInline(source), node, {
      flat,
      site: useHost().site,
    }),
  )

/** Formatted prose for conversation replies and cards. @module */
import {
  createElement as h,
  Fragment,
  type ReactElement,
  type ReactNode as Node,
} from 'react'
import { blocks, parse, useHost } from '@yaks/markdown'
import { Body } from '@yaks/ui/parts'

// A bare URL is drawn as its hostname.
let shortened = (href: unknown, kids: Node[]): Node[] => {
  let url = typeof href == 'string' && /^https?:/.test(href) &&
    URL.parse(href)
  return url && kids.flat().join('') == href
    ? [url.host.replace(/^www\./, '')]
    : kids
}

let short =
  ((tag: string, props: Record<string, unknown> | null, ...kids: Node[]) =>
    h(
      tag,
      props,
      ...tag == 'a' ? shortened(props?.href, kids) : kids,
    )) as typeof h

let Prose = ({ text }: { text: string }): ReactElement =>
  h(Fragment, null, ...blocks(parse(text), short, useHost()))

/** Draw Markdown in the kit's Body, with entity links supplied by the page's
 * `Host` from @yaks/markdown, and a link off the page's site opening in a new
 * tab (@yaks/markdown/away). */
export let markdown = (text: string): ReactElement =>
  h(Body, { mod: 'flow' }, h(Prose, { text }))

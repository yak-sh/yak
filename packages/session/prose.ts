/** Formatted prose for conversation replies and cards. @module */
import { type ComponentChildren as Node, Fragment, h, type VNode } from 'preact'
import { useContext } from 'preact/hooks'
import { blocks, Host, parse } from '@yaks/markdown'
import { Body } from '@yaks/ui/parts'

// A bare URL is drawn as its hostname.
let shortened = (href: unknown, kids: Node[]): Node[] => {
  let url = typeof href == 'string' && /^https?:/.test(href) &&
    URL.parse(href)
  return url && kids.flat().join('') == href
    ? [url.host.replace(/^www\./, '')]
    : kids
}

// An id that opens on another site opens in a tab of its own.
let away =
  ((tag: string, props: Record<string, unknown> | null, ...kids: Node[]) =>
    h(
      tag,
      tag == 'a' && props?.['data-ref'] && /^https?:/.test(String(props.href))
        ? { ...props, target: '_blank', rel: 'noopener' }
        : props,
      ...tag == 'a' ? shortened(props?.href, kids) : kids,
    )) as typeof h

let Prose = ({ text }: { text: string }): VNode =>
  h(Fragment, null, ...blocks(parse(text), away, useContext(Host)))

/** Draw Markdown in the kit's Body, with entity links supplied by the page's
 * `Host` from @yaks/markdown. */
export let markdown = (text: string): VNode =>
  h(Body, { mod: 'flow' }, h(Prose, { text }))

// Markdown a person wrote, on one of the platform's own pages: an
// integration's instructions, which its owner writes and anyone may read.
// @yaks/markdown draws it, keeping HTML as text, leaving out a link to any
// scheme but http, https and mailto, and loading no image. Every link is marked
// rel="nofollow ugc", since what it points at is the writer's to vouch for, not
// ours. It is the kit's Body. The renderer loads when a page first draws some
// (docs.ts `marked`).
import { createElement as h, type ReactNode } from 'react'
import { markup as renderToString } from '@yaks/html'

// The page's elements, with each link said to be the writer's.
let theirs = ((
  tag: string,
  props: Record<string, unknown> | null,
  ...children: ReactNode[]
) =>
  h(
    tag,
    tag == 'a'
      ? {
        ...props,
        rel: [props?.rel, 'nofollow ugc'].filter(Boolean).join(' '),
      }
      : props,
    ...children,
  )) as typeof h

/** Markdown someone wrote, as HTML a page may hold; empty for none. */
export let drawn = async (source = ''): Promise<string> => {
  if (!source.trim()) return ''
  let md = await import('@yaks/markdown')
  let tokens = md.parse(source, { breaks: false })
  return renderToString(
    theirs('div', { class: 'Body' }, ...md.blocks(tokens, theirs)),
  )
}

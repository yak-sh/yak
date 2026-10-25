// Markdown a person wrote, on one of the platform's own pages: an
// integration's instructions, which its owner writes and anyone may read.
// @yaks/markdown draws it, keeping HTML as text, leaving out a link to any
// scheme but http, https and mailto, and loading no image. Every link is marked
// rel="nofollow ugc", since what it points at is the writer's to vouch for, not
// ours. The renderer loads when a page first draws some (docs.ts `marked`).
import { type ComponentChildren, h } from 'preact'
import { renderToString } from 'preact-render-to-string'

// The page's elements, with each link said to be the writer's.
let theirs = ((
  tag: string,
  props: Record<string, unknown> | null,
  ...children: ComponentChildren[]
) =>
  h(
    tag,
    tag == 'a' ? { ...props, rel: 'nofollow ugc' } : props,
    ...children,
  )) as typeof h

/** Markdown someone wrote, as HTML a page may hold; empty for none. */
export let drawn = async (source = ''): Promise<string> => {
  if (!source.trim()) return ''
  let md = await import('@yaks/markdown')
  return renderToString(md.render(md.parse(source, { breaks: false }), theirs))
}

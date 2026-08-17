// The one DOM door for markdown. Callers choose the host so markdown keeps
// the layout, gestures, and CSS of the face it fills; only this file owns the
// innerHTML prop fed by md.ts's untrusted-content boundary.
import { type ComponentType, type JSX } from 'preact'
import { md, mdInline } from '../md.ts'

type FaceProps = {
  dangerouslySetInnerHTML?: { __html: string }
  [x: string]: unknown
}

export let markup = (text: string, repo?: string | null, inline = false) =>
  inline ? mdInline(text) : md(text, repo)

export let markdown = (text: string, repo?: string | null, inline = false) => ({
  dangerouslySetInnerHTML: {
    __html: markup(text, repo, inline),
  },
})

// The paint seam. The web injects HTML through dangerouslySetInnerHTML, but a
// host whose DOM can't honor that prop (the TUI's fake DOM silently drops it,
// so a body renders blank) installs a painter here at boot — the one markdown
// door stays one door, each medium painting the form it can. Untrusted content
// gains no reach: the painter renders into real nodes the TUI's own boundary
// (paint.ts safe()) still strips before a byte reaches the terminal.
type Painter = (
  text: string,
  repo?: string | null,
  inline?: boolean,
) => JSX.Element
let painter = { fn: null as Painter | null }
export let onMarkdown = (fn: Painter) => painter.fn = fn

export let Markdown = (
  { as: Face = 'div', text, repo, inline, ...props }: {
    as?: ComponentType<FaceProps> | 'div'
    text: string
    repo?: string | null
    inline?: boolean
    [x: string]: unknown
  },
) =>
  painter.fn
    ? <Face {...props}>{painter.fn(text, repo, inline)}</Face>
    : <Face {...props} {...markdown(text, repo, inline)} />

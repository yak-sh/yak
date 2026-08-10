// The one DOM door for markdown. Callers choose the host so markdown keeps
// the layout, gestures, and CSS of the face it fills; only this file owns the
// innerHTML prop fed by md.ts's untrusted-content boundary.
import { type ComponentType } from 'preact'
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

export let Markdown = (
  { as: Face = 'div', text, repo, inline, ...props }: {
    as?: ComponentType<FaceProps> | 'div'
    text: string
    repo?: string | null
    inline?: boolean
    [x: string]: unknown
  },
) => <Face {...props} {...markdown(text, repo, inline)} />

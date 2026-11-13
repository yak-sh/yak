/** @jsxImportSource preact */
// Markdown in browse is @yaks/markdown, drawn as nodes in the face its caller
// chooses, so it keeps that face's layout, gestures and CSS, in the browser
// and the terminal alike. Markup a body wrote stays words; what browse adds is
// where an id leads (`refs`) and how code is coloured (`code`).
//
// An id leads to its page here, its anchor carrying data-ref so nav.tsx's
// delegated listeners give it the in-app open and entity menu. A hex word
// quoted in code is a commit, linked to its project's repository when the
// caller knows one; a whole SHA is the commit's own entity.
import {
  type ComponentChildren,
  type ComponentType,
  h,
  type VNode,
} from 'preact'
import type { H } from '@yaks/render'
import {
  blocks,
  Host,
  MarkdownInline,
  type Options,
  parse,
  type Refs,
  type Run,
} from '@yaks/markdown'
import { highlight } from '../highlight.ts'
import { EID } from '../types.ts'
import { entityPath } from '../url.ts'

let SHA = /^[0-9a-f]{7,40}$/i

// A project supplies the repository root; a commit is one stable page below
// it. Only an http address can become a link, since repo settings ride the
// same untrusted graph as prose.
export let commitUrl = (repo: string | null | undefined, sha: string) => {
  let root = String(repo ?? '').trim().replace(/\/+$/, '')
  return SHA.test(sha) && /^https?:\/\//i.test(root)
    ? `${root}/commit/${sha}`
    : undefined
}

let HEXWORD = /^[0-9a-f]+$/i

/** Where an id leads in browse, for prose that belongs to `repo`'s project. */
export let refs = (repo?: string | null): Refs => (id) =>
  HEXWORD.test(id) && !EID.test(id) ? commitUrl(repo, id) : entityPath(id)

/** Code coloured by highlight.ts, as runs of classed text. */
export let code = (text: string, language?: string): Run[] =>
  highlight(text, language).lines.flatMap((line, i) =>
    i ? [{ text: '\n', classes: [] }, ...line] : line
  )

/** What browse gives every Markdown beneath it, inspect pages included. */
export let host: Options = { refs: refs(), code }

let hosts = new Map<string, Options>()
let hosted = (repo?: string | null) => {
  let key = repo ?? ''
  let found = hosts.get(key)
  if (!found) hosts.set(key, found = { refs: refs(repo), code })
  return found
}

/** Some Markdown as the nodes browse draws it: a document's blocks, or a
 * title's inline line, its links and ids flattened to words because a title
 * is usually itself the link. */
export let markup = (
  text: string,
  repo?: string | null,
  inline = false,
): ComponentChildren =>
  inline
    ? <MarkdownInline source={text} flat />
    : blocks(parse(text, { breaks: false }), h as H<VNode>, hosted(repo))

/** Browse's Markdown for everything beneath `children`. */
export let MarkdownHost = ({ children }: { children: ComponentChildren }) => (
  <Host.Provider value={host}>{children}</Host.Provider>
)

export let Markdown = (
  { as: Face = 'div', text, repo, inline, ...props }: {
    as?: ComponentType<Record<string, unknown>> | 'div'
    text: string
    repo?: string | null
    inline?: boolean
    [x: string]: unknown
  },
) => <Face {...props}>{markup(text, repo, inline)}</Face>

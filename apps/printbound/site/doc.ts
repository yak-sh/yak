/** A guide or a policy: Markdown under a few lines saying what it is
 * (`pages/<name>.md`), read in one column under its cover. A `prompt` fence
 * is words to take away, drawn on a dusk card with a press that copies them
 * (copy.js). */
import { type FunctionComponent, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Marked } from 'marked'
import { Body, Button } from '@yaks/ui/parts'
import { Page } from './frame.ts'
import { Cover, Prompt, Reading } from './parts.ts'

/** A page as its file says it. */
export type Doc = {
  title: string
  /** what kind of page, over the title */
  eyebrow?: string
  /** a line under the title: when it took effect, who it is for */
  meta?: string
  description: string
  /** the tab's title */
  head: string
  /** its Markdown */
  body: string
}

/** A page's file, read: `name: value` lines between two rules, then the
 * Markdown. */
export let read = (text: string): Doc => {
  let [, said = '', body = text] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(
    text,
  ) ?? []
  let fields = Object.fromEntries(
    said.split('\n').filter(Boolean).map((line) => {
      let at = line.indexOf(': ')
      return [line.slice(0, at), line.slice(at + 2).trim()]
    }),
  )
  return {
    title: '',
    description: '',
    head: fields.title ?? '',
    ...fields,
    // The line that keeps the formatter off the file is none of the page.
    body: body.replace(/^\s*<!-- deno-fmt-ignore-file -->\n/, ''),
  }
}

// A link to a place in the app starts from the app's address; one within the
// page, to mail or to another site stays as written.
let placed = (href: string, base: string) =>
  /^(#|[a-z][a-z\d+.-]*:|\/\/)/i.test(href)
    ? href
    : base + href.replace(/^\.?\//, '')

let html = (markdown: string, base: string) =>
  new Marked({
    gfm: true,
    renderer: {
      link({ href, title, tokens }) {
        return renderToString(
          h('a', {
            href: placed(href, base),
            title: title ?? undefined,
            dangerouslySetInnerHTML: {
              __html: this.parser.parseInline(tokens),
            },
          }),
        )
      },
      code({ text, lang = '' }) {
        let [kind, ...label] = lang.split(' ')
        if (kind != 'prompt') return false
        return renderToString(
          h(
            Prompt,
            {},
            h(
              Prompt.Bar,
              {},
              h(Prompt.Label, {}, label.join(' ')),
              h(Button, { type: 'button', 'data-copy': true }, 'Copy'),
            ),
            h(Prompt.Text, {}, text),
          ),
        )
      },
    },
  }).parse(markdown, { async: false })

/** A guide or a policy's page. */
export let Guide: FunctionComponent<
  { base: string; doc: Doc; path: string }
> = ({ base, doc, path }) =>
  h(
    Page,
    { base, head: doc.head, description: doc.description, path },
    h(
      Cover,
      {},
      h(
        Cover.Inner,
        {},
        doc.eyebrow && h(Cover.Eyebrow, {}, doc.eyebrow),
        h(Cover.Title, {}, doc.title),
        doc.meta && h(Cover.Meta, {}, doc.meta),
      ),
    ),
    h(
      Reading,
      { id: 'main' },
      h(Body, { dangerouslySetInnerHTML: { __html: html(doc.body, base) } }),
    ),
    doc.body.includes('```prompt') &&
      h('script', { src: base + 'copy.js', defer: true }),
  )

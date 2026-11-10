/** A short page that says one thing to one person: how their order stands,
 * what they chose about mail. Its title over what it holds, in the frame. */
import { type ComponentChildren, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Page } from './frame.ts'
import { Reading } from './parts.ts'

/** The page, as a browser is sent it. */
export let note = (
  base: string,
  title: string,
  ...children: ComponentChildren[]
): string =>
  '<!doctype html>\n' + renderToString(
    h(
      Page,
      { base, head: title, description: '', path: '' },
      h(Reading, { id: 'main' }, h('h1', {}, title), ...children),
    ),
  )

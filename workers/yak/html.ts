// What server-rendered pages say: text escaped for HTML and quoted
// attributes, a day the way a person reads it, and the parts more than one
// page draws.
import { Drop } from '@yaks/ui/parts'
import { type ComponentChildren, Fragment, h, type VNode } from 'preact'
import { jsxTemplate } from 'preact/jsx-runtime'
import { renderToString } from 'preact-render-to-string'

/** A page's tree, or a run of them, as the HTML it sends, rendered once at
 * the page's edge: every string in it is text, escaped by Preact. */
/// markup(['a', null, '<b>']) -> 'a&lt;b>'
export let markup = (nodes: ComponentChildren): string =>
  renderToString(h(Fragment, null, nodes))

/** Markup we made ourselves (an entity renderer's row, a guide drawn from
 * Markdown) put into a tree as it is, with no element around it. Never what
 * a person typed: that is a string child, which Preact escapes. */
/// import { h } from 'preact'
/// markup(h('p', null, raw('<b>a</b>'), ' & ', '<b>')) -> '<p><b>a</b> &amp; &lt;b></p>'
export let raw = (html: string): VNode => jsxTemplate([html])

export let esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

// Reuse the two formatters: date formatting should not construct an ICU
// formatter for every cell of a server-rendered page.
let days = Object.fromEntries(
  (['long', 'short'] as const).map((month) => [
    month,
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month,
      year: 'numeric',
      timeZone: 'UTC',
    }),
  ]),
)

// The month said short where a day sits in a narrow column.
/// day('2026-10-13T11:37:16.784Z') -> '13 October 2026'
/// day('2026-10-13T11:37:16.784Z', 'short') -> '13 Oct 2026'
/// day('soon') -> ''
export let day = (iso: string, month: 'long' | 'short' = 'long') => {
  let at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : days[month].format(at)
}

let minutes = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
})

// A moment to the minute, where when it changed matters more than its day.
/// moment('2026-10-13T11:37:16.784Z') -> '13 Oct 2026, 11:37 UTC'
/// moment('soon') -> ''
export let moment = (iso: string) => {
  let at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : `${minutes.format(at)} UTC`
}

// A file input as a drop zone (@yaks/ui `Drop`, public/drop.js): the
// form's own input inside a place to press or drop on, and the list of what
// is chosen under it. `label` names the input; `hint` says what it takes,
// `accept` which kinds the chooser offers, and `size` the most bytes of one
// file. One that `sends` sends its form the moment a file is chosen.
export let fileDrop = (o: {
  name: string
  label: string
  hint?: string
  multiple?: boolean
  required?: boolean
  accept?: string
  size?: number
  sends?: boolean
}) =>
  h(
    Drop,
    null,
    h(
      Drop.Zone,
      null,
      h(Drop.File, {
        type: 'file',
        name: o.name,
        'aria-label': o.label,
        multiple: o.multiple,
        required: o.required,
        accept: o.accept,
        'data-size': o.size,
        'data-sends': o.sends ? '' : undefined,
      }),
      h(
        Drop.Say,
        null,
        h(Drop.Choose, null, `Choose ${o.multiple ? 'files' : 'a file'}`),
        ` or drop ${o.multiple ? 'them' : 'it'} here`,
      ),
      o.hint ? h(Drop.Hint, null, o.hint) : null,
    ),
    o.size ? h(Drop.Said, { role: 'status' }) : null,
    h(Drop.Chosen, { 'aria-live': 'polite' }),
  )

// What server-rendered pages say: text escaped for HTML and quoted
// attributes, a day the way a person reads it, and the parts more than one
// page draws.
import { Drop } from '@yaks/ui/parts'
import { type ComponentChildren, Fragment, h, type VNode } from 'preact'
import { jsxTemplate } from 'preact/jsx-runtime'
import { renderToString } from 'preact-render-to-string'
export { esc } from './escape.ts'

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

// Plain dates in prose use the kit formatter, with server text in UTC.
import { day as date, pretty } from '@yaks/ui/relative'
export let day = (iso: string): string => date(iso, 'UTC')
export let moment = (iso: string): string =>
  pretty(iso, 'UTC') ? `${pretty(iso, 'UTC')} UTC` : ''

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

// What server-rendered pages say: text escaped for HTML and quoted
// attributes, a day the way a person reads it, and the parts more than one
// page draws.
import {
  createElement as h,
  Fragment,
  type ReactElement,
  type ReactNode,
} from 'react'
import { jsxTemplate } from 'preact/jsx-runtime'
import { renderToString } from 'preact-render-to-string'
export { esc } from '@yaks/platform/escape'

/** A page's tree, or a run of them, as the HTML it sends, rendered once at
 * the page's edge: every string in it is text, escaped by Preact. */
/// markup(['a', null, '<b>']) -> 'a&lt;b>'
export let markup = (nodes: ReactNode): string =>
  renderToString(h(Fragment, null, nodes))

/** Markup we made ourselves (an entity renderer's row, a guide drawn from
 * Markdown) put into a tree as it is, with no element around it. Never what
 * a person typed: that is a string child, which Preact escapes. */
/// import { h } from 'preact'
/// markup(h('p', null, raw('<b>a</b>'), ' & ', '<b>')) -> '<p><b>a</b> &amp; &lt;b></p>'
export let raw = (html: string): ReactElement => jsxTemplate([html])

// Plain dates in prose use the kit formatter, with server text in UTC.
import { day as date, pretty } from '@yaks/ui/relative'
export let day = (iso: string): string => date(iso, 'UTC')
export let moment = (iso: string): string =>
  pretty(iso, 'UTC') ? `${pretty(iso, 'UTC')} UTC` : ''

export { sentence } from '@yaks/platform/page-parts'

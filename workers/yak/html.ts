// What server-rendered pages say: text escaped for HTML and quoted
// attributes, a day the way a person reads it, and the parts more than one
// page draws.
import { type ComponentChildren, Fragment, h, type VNode } from 'preact'
import { jsxTemplate } from 'preact/jsx-runtime'
import { renderToString } from 'preact-render-to-string'
export { esc } from '@yaks/platform/escape'

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

// A sentence out of a lowercase line: what a failed seal wrote beside it. An
// email address that opens it stays as it was typed.
/// sentence('no app x in y') -> 'No app x in y.'
/// sentence('ana@x.test is you') -> 'ana@x.test is you.'
export let sentence = (text: string) =>
  (/^\S+@/.test(text) ? text : text.charAt(0).toUpperCase() + text.slice(1)) +
  (/[.!?]$/.test(text) ? '' : '.')

// What server-rendered pages say: text escaped for HTML and quoted
// attributes, and a day the way a person reads it.
import type { VNode } from 'preact'
import { jsxTemplate } from 'preact/jsx-runtime'
import { renderToString } from 'preact-render-to-string'

/** A page's tree as the HTML it sends, rendered once at the page's edge:
 * every string in it is text, escaped by Preact. */
export let markup = <P>(node: VNode<P>): string => renderToString(node)

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

// A link in a side navigation (@yaks/ui `SideNav`): `face` is what it shows,
// as HTML, and `href` an address already fit for an attribute. The page you
// are on is lit, and says so; `also` is a page's own class for it.
/// sideLink('/a', 'A') -> '<a class="SideNav_Link" href="/a">A</a>'
/// sideLink('/a', 'A', true) -> '<a class="SideNav_Link SideNav_Link-on" href="/a" aria-current="page">A</a>'
/// sideLink('/a', 'A', false, 'Talk_All') -> '<a class="SideNav_Link Talk_All" href="/a">A</a>'
export let sideLink = (href: string, face: string, on = false, also = '') =>
  `<a class="${
    ['SideNav_Link', on && 'SideNav_Link-on', also].filter(Boolean).join(' ')
  }" href="${href}"${on ? ' aria-current="page"' : ''}>${face}</a>`

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
  `<div class="Drop"><label class="Drop_Zone"><input class="Drop_File" type="file" name="${
    esc(o.name)
  }" aria-label="${esc(o.label)}"${o.multiple ? ' multiple' : ''}${
    o.required ? ' required' : ''
  }${o.accept ? ` accept="${esc(o.accept)}"` : ''}${
    o.size ? ` data-size="${o.size}"` : ''
  }${
    o.sends ? ' data-sends' : ''
  }><span class="Drop_Say"><span class="Drop_Choose">Choose ${
    o.multiple ? 'files' : 'a file'
  }</span> or drop ${o.multiple ? 'them' : 'it'} here</span>${
    o.hint ? `<span class="Drop_Hint">${esc(o.hint)}</span>` : ''
  }</label>${
    o.size ? '<p class="Drop_Said" role="status"></p>' : ''
  }<ul class="Drop_Chosen" aria-live="polite"></ul></div>`

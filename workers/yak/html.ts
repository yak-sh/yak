// What server-rendered pages say: text escaped for HTML and quoted
// attributes, and a day the way a person reads it.
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

// A file input as a drop zone (controls.css `.Drop`, public/drop.js): the
// form's own input inside a place to press or drop on, and the list of what
// is chosen under it. `label` names the input; `hint` says what it takes.
export let fileDrop = (o: {
  name: string
  label: string
  hint?: string
  multiple?: boolean
  required?: boolean
}) =>
  `<div class="Drop"><label class="Drop_Zone"><input class="Drop_File" type="file" name="${
    esc(o.name)
  }" aria-label="${esc(o.label)}"${o.multiple ? ' multiple' : ''}${
    o.required ? ' required' : ''
  }><span class="Drop_Say"><span class="Drop_Choose">Choose ${
    o.multiple ? 'files' : 'a file'
  }</span> or drop ${o.multiple ? 'them' : 'it'} here</span>${
    o.hint ? `<span class="Drop_Hint">${esc(o.hint)}</span>` : ''
  }</label><ul class="Drop_Chosen" aria-live="polite"></ul></div>`

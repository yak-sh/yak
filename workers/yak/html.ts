// What server-rendered pages say: text escaped for HTML and quoted
// attributes, and a day the way a person reads it.
export let esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

/// day('2026-10-13T11:37:16.784Z') -> '13 October 2026'
/// day('soon') -> ''
export let day = (iso: string) => {
  let at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

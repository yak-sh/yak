// Text escaped for HTML and quoted attributes, shared by server and browser.
export let esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

let NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
}

// What `esc` wrote, read back as text: the named references it writes, and
// any numeric one. A name it never writes stays as it is.
export let unesc = (s: string) =>
  s.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi,
    (all, dec, hex, name) =>
      dec || hex
        ? String.fromCodePoint(parseInt(dec ?? hex, dec ? 10 : 16))
        : NAMED[name] ?? all,
  )

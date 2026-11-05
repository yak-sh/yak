// HTML as strings with everything interpolated escaped, unless it was made
// by `html` itself (or is an array of what it made).

class Raw {
  constructor(s) {
    this.s = s
  }
  toString() {
    return this.s
  }
}
let ESC = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
let flat = (v) =>
  v == null || v === false
    ? ''
    : v instanceof Raw
    ? v.s
    : Array.isArray(v)
    ? v.map(flat).join('')
    : String(v).replace(/[&<>"']/g, (c) => ESC[c])

export let raw = (s) => new Raw(String(s ?? ''))
export let html = (strings, ...values) =>
  raw(
    strings.reduce(
      (a, s, i) => a + s + (i < values.length ? flat(values[i]) : ''),
      '',
    ),
  )

let PATHS = {
  inbox:
    '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
  lists:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  next: '<path d="M9 18l6-6-6-6"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
}
export let icon = (name) =>
  raw(
    `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${
      PATHS[name] ?? ''
    }</svg>`,
  )

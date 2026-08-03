// The terminal's content boundary. Anything printed from the graph may carry
// control bytes, so text loses the whole control class before a renderer adds
// its own escapes. Newlines and FTS hit marks carry meaning in the graph; tabs
// become spaces chosen here rather than cursor movement chosen by a terminal.

// deno-lint-ignore no-control-regex -- the control class IS the subject
let ctrl = /[\x00-\x1f\x7f-\x9f]/g
let keep = new Set('\x01\x02\n')

export let safe = (text: string) =>
  text.replaceAll('\t', '  ').replace(ctrl, (c) => keep.has(c) ? c : '')

// An href rides inside an OSC 8 sequence, so none of the control class can
// survive there — including text controls that are meaningful elsewhere.
export let safeHref = (href: string) => href.replace(ctrl, '')

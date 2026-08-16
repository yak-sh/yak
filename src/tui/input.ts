// Decode a raw stdin chunk into the key tokens App.key() understands.
//
// A terminal can't express Shift+Enter as a distinct byte on its own — it
// collapses to CR, the same as a plain Enter — so main asks for the kitty
// keyboard protocol (ESC[>1u). Under it, modified and otherwise-ambiguous keys
// report as CSI-u (`ESC [ code ; mods u`, mods = 1 + a shift/alt/ctrl bitmask).
// We decode the keys the app actually binds back to their legacy bytes, so
// App.key() needs no changes, and we surface Shift+Enter as a newline. Plain
// unmodified keys still arrive as their own bytes and pass straight through; an
// upgraded key the app doesn't bind is dropped, the way the old loop dropped
// arrow and function-key sequences rather than dribbling their bytes through.
// deno-lint-ignore no-control-regex -- the ESC that opens a CSI-u IS the subject
let csiU = /^\x1b\[(\d+)(?:;(\d+))?u$/

export let decode = (s: string): string[] => {
  let m = s.match(csiU)
  if (m) {
    let code = +m[1]
    let mods = (m[2] ? +m[2] : 1) - 1 // kitty encodes mods as 1 + bitmask
    let shift = mods & 1, ctrl = mods & 4
    if (code == 13) return [shift ? '\n' : '\r'] // Enter; ⇧⏎ → newline
    if (code == 27) return ['\x1b'] // Escape
    if (code == 9) return [shift ? '\x1b[Z' : '\t'] // Tab / ⇧⇥
    if (code == 127) return ['\x7f'] // Backspace
    if (ctrl && code == 99) return ['\x03'] // Ctrl-C
    if (ctrl && code == 100) return ['\x04'] // Ctrl-D
    if (!mods && code >= 32) return [String.fromCodePoint(code)] // plain text key
    return [] // a modified key the app doesn't bind
  }
  // A legacy multi-byte escape sequence: only ⇧⇥ is spoken for; the rest
  // (arrows, function keys) are dropped rather than typed in one char at a time.
  if (s.length > 1 && s.startsWith('\x1b')) return s == '\x1b[Z' ? [s] : []
  return [...s]
}

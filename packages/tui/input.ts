/**
 * Raw stdin bytes as keys. A terminal cannot express Shift+Enter as a byte of
 * its own — it collapses to CR, the same as a plain Enter — so `run` asks for
 * the kitty keyboard protocol (`ESC[>1u`), under which modified and otherwise
 * ambiguous keys report as CSI-u (`ESC [ code ; mods u`, mods = 1 + a
 * shift/alt/ctrl bitmask). This decodes those, the legacy escape sequences
 * every terminal still sends (arrows, home/end, page keys, SS3), SGR mouse
 * wheel reports and bracketed paste, into one `Key` shape. Runs of printable
 * characters come through as a single `char` key, so a fast typist and a
 * pasted paragraph cost one render each.
 *
 * @module
 */

/** What a key is: a name, its modifiers, and text for `char` and `paste`. */
export type Key = {
  name: Name
  text?: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

/** SGR pointer report, in zero-based terminal cells (never a keyboard key). */
export type Mouse = {
  name: 'mouse'
  type: 'wheel' | 'mousedown' | 'mouseup' | 'mousemove'
  x: number
  y: number
  button: number
  deltaX: number
  deltaY: number
  release: boolean
  shift: boolean
  alt: boolean
  ctrl: boolean
}
export type Input = Key | Mouse

/** The keys this decoder names. Anything else is dropped. */
export type Name =
  | 'char'
  | 'enter'
  | 'escape'
  | 'tab'
  | 'backspace'
  | 'delete'
  | 'insert'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'home'
  | 'end'
  | 'pageup'
  | 'pagedown'
  | 'paste'
  | 'wheelup'
  | 'wheeldown'

let PASTE_ON = '\x1b[200~'
let PASTE_OFF = '\x1b[201~'

// kitty encodes modifiers as 1 + a bitmask; a mods field of 0 means none.
let mods = (v: string | undefined) => {
  let m = (v ? +v : 1) - 1
  return { shift: !!(m & 1), alt: !!(m & 2), ctrl: !!(m & 4) }
}

let only = (k: Key) => {
  if (!k.shift) delete k.shift
  if (!k.alt) delete k.alt
  if (!k.ctrl) delete k.ctrl
  return k
}

let arrows: Record<string, Name> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
}
let tildes: Record<string, Name> = {
  '1': 'home',
  '2': 'insert',
  '3': 'delete',
  '4': 'end',
  '5': 'pageup',
  '6': 'pagedown',
  '7': 'home',
  '8': 'end',
}

// deno-lint-ignore no-control-regex -- the ESC that opens a sequence IS the subject
let csiU = /^\x1b\[(\d+)(?:;(\d+))?u/
// deno-lint-ignore no-control-regex -- ditto
let sgr = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/
// deno-lint-ignore no-control-regex -- ditto
let tilde = /^\x1b\[(\d+)(?:;(\d+))?~/
// deno-lint-ignore no-control-regex -- ditto
let csi = /^\x1b\[(?:\d+;(\d+))?([A-DHFZ])/
// deno-lint-ignore no-control-regex -- ditto
let ss3 = /^\x1bO([A-DHF])/

// A CSI-u report for a key that already has a name of its own.
let named: Record<number, Name> = {
  8: 'backspace',
  9: 'tab',
  13: 'enter',
  27: 'escape',
  127: 'backspace',
}

// One escape sequence at `i`: the key it means (null = drop it) and its length.
let escape = (s: string, i: number): [Input | null, number] => {
  let rest = s.slice(i)
  // xterm modifyOtherKeys, also used by tmux's extended-keys mode.
  // deno-lint-ignore no-control-regex -- ESC is part of the terminal protocol
  let extended = rest.match(/^\x1b\[27;(\d+);(\d+)~/)
  if (extended) {
    let [, modifier, code] = extended
    let [key] = escape('\x1b[' + code + ';' + modifier + 'u', 0)
    return [key, extended[0].length]
  }
  let m = rest.match(csiU)
  if (m) {
    let code = +m[1], mod = mods(m[2])
    let name = named[code]
    if (name) return [only({ name, ...mod }), m[0].length]
    if (code < 32) return [null, m[0].length]
    let text = String.fromCodePoint(code)
    if (mod.shift && !mod.ctrl && !mod.alt) text = text.toUpperCase()
    return [only({ name: 'char', text, ...mod }), m[0].length]
  }
  if ((m = rest.match(sgr))) {
    let bits = +m[1], button = bits & 3, release = m[4] == 'm'
    if (+m[2] < 1 || +m[3] < 1) return [null, m[0].length]
    return [{
      name: 'mouse',
      type: release
        ? 'mouseup'
        : bits & 64
        ? 'wheel'
        : bits & 32
        ? 'mousemove'
        : 'mousedown',
      x: +m[2] - 1,
      y: +m[3] - 1,
      button,
      release,
      deltaX: bits & 64 && button >= 2 ? (button == 2 ? -1 : 1) : 0,
      deltaY: bits & 64 && button < 2 ? (button == 0 ? -1 : 1) : 0,
      shift: !!(bits & 4),
      alt: !!(bits & 8),
      ctrl: !!(bits & 16),
    }, m[0].length]
  }
  if ((m = rest.match(tilde))) {
    let name = tildes[m[1]]
    return [name ? only({ name, ...mods(m[2]) }) : null, m[0].length]
  }
  if ((m = rest.match(csi))) {
    if (m[2] == 'Z') return [{ name: 'tab', shift: true }, m[0].length]
    return [only({ name: arrows[m[2]], ...mods(m[1]) }), m[0].length]
  }
  if ((m = rest.match(ss3))) return [{ name: arrows[m[1]] }, m[0].length]
  // Alt+key: the terminal's oldest modifier, an ESC prefix on the key itself.
  let c = rest[1]
  if (c == '\x7f' || c == '\x08') return [{ name: 'backspace', alt: true }, 2]
  if (c && c >= ' ' && c != '\x7f') {
    return [{ name: 'char', text: c, alt: true }, 2]
  }
  return [{ name: 'escape' }, 1]
}

/**
 * Decode one chunk. A bracketed paste without its terminator is taken whole,
 * so a paste split across reads needs `feed()` rather than this.
 */
export let decode = (s: string): Input[] => {
  let out: Input[] = []
  let i = 0
  while (i < s.length) {
    let c = s[i]
    if (s.startsWith(PASTE_ON, i)) {
      let end = s.indexOf(PASTE_OFF, i)
      let text = s.slice(i + PASTE_ON.length, end < 0 ? undefined : end)
      out.push({ name: 'paste', text })
      i = end < 0 ? s.length : end + PASTE_OFF.length
      continue
    }
    if (c == '\x1b') {
      let [key, n] = escape(s, i)
      if (key) out.push(key)
      i += n
      continue
    }
    if (c == '\r' || c == '\n') out.push({ name: 'enter' })
    else if (c == '\x7f' || c == '\x08') out.push({ name: 'backspace' })
    else if (c == '\t') out.push({ name: 'tab' })
    else if (c < ' ') {
      out.push({
        name: 'char',
        text: String.fromCharCode(97 + c.charCodeAt(0) - 1),
        ctrl: true,
      })
    } else {
      let j = i
      while (j < s.length && s[j] >= ' ' && s[j] != '\x7f') j++
      out.push({ name: 'char', text: s.slice(i, j) })
      i = j
      continue
    }
    i++
  }
  return out
}

/**
 * A decoder that survives chunk boundaries: an unterminated bracketed paste is
 * held until the terminator arrives rather than arriving as two edits.
 */
export let feed = (): (chunk: string) => Input[] => {
  let held = ''
  return (chunk) => {
    let s = held + chunk
    let open = s.lastIndexOf(PASTE_ON)
    if (open >= 0 && s.indexOf(PASTE_OFF, open) < 0) {
      held = s.slice(open)
      s = s.slice(0, open)
    } else held = ''
    // Keep a fragmented SGR report, but preserve bare Escape key behavior.
    // deno-lint-ignore no-control-regex -- fragmented terminal protocol
    let partial = s.match(/\x1b\[<(?:\d+(?:;\d*)?(?:;\d*)?)?$/)
    if (partial) {
      held = partial[0] + held
      s = s.slice(0, partial.index)
    }
    return decode(s)
  }
}

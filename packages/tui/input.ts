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
  if (c == '\r' || c == '\n') return [{ name: 'enter', alt: true }, 2]
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
    if (s.startsWith('\x1b_', i) || s.startsWith('\x1bP', i)) {
      let end = s.indexOf('\x1b\\', i + 2)
      i = end < 0 ? s.length : end + 2
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

/** Read a chunk, or flush the Escape a chunk may have left held. */
export type Feed = ((chunk: string) => Input[]) & { flush: () => Input[] }

/**
 * Incremental keyboard decoder. Holds partial paste/control replies and routes
 * APC/DCS replies away from keyboard handlers. Call flush after a short idle
 * interval to dispatch a standalone Escape key.
 */
export let feed = (
  onControl: (body: string) => void = () => {},
): Feed => {
  let held = ''
  let dropping = false
  let read = (chunk: string): Input[] => {
    let s = held + chunk
    held = ''
    let plain = ''
    for (let i = 0; i < s.length;) {
      if (dropping) {
        let end = s.indexOf('\x1b\\', i)
        if (end < 0) {
          held = s.endsWith('\x1b') ? '\x1b' : ''
          break
        }
        dropping = false
        i = end + 2
        continue
      }
      if (s.startsWith(PASTE_ON, i)) {
        let end = s.indexOf(PASTE_OFF, i + PASTE_ON.length)
        if (end < 0) {
          held = s.slice(i)
          break
        }
        plain += s.slice(i, end + PASTE_OFF.length)
        i = end + PASTE_OFF.length
        continue
      }
      if (s.startsWith('\x1b_', i) || s.startsWith('\x1bP', i)) {
        let end = i + 2
        // tmux doubles embedded ESC; only an unescaped ST ends its wrapper.
        for (; end < s.length; end++) {
          if (s[end] != '\x1b') continue
          if (s[end + 1] == '\x1b') {
            end++
            continue
          }
          if (s[end + 1] == '\\') break
        }
        if (end >= s.length) {
          if (s.length - i > 8192) {
            dropping = true
            held = s.endsWith('\x1b') ? '\x1b' : ''
          } else held = s.slice(i)
          break
        }
        let body = s.slice(i + 2, end)
        if (s[i + 1] == 'P' && body.startsWith('tmux;')) {
          body = body.slice(5).replaceAll('\x1b\x1b', '\x1b')
          if (body.startsWith('\x1b_') && body.endsWith('\x1b\\')) {
            body = body.slice(2, -2)
          }
        }
        if (body.length <= 8192) onControl(body)
        i = end + 2
        continue
      }
      let tail = s.slice(i)
      if (tail == '\x1b' || PASTE_ON.startsWith(tail) || tail == '\x1b[') {
        held = tail
        break
      }
      // A terminal sequence is one event even when SSH/stdin splits its bytes.
      // CSI parameters/intermediates end only at the final byte (@ through ~).
      // Hold SS3's introducer too. Complete events still dispatch immediately.
      // deno-lint-ignore no-control-regex -- incomplete CSI sequence
      if (/^\x1b\[[\x20-\x3f]*$/.test(tail) || tail == '\x1bO') {
        // Bound malformed unterminated keyboard reports separately from APC data.
        if (tail.length <= 128) held = tail
        break
      }
      plain += s[i++]
    }
    return decode(plain)
  }
  // A bare Escape needs a short timeout; incomplete control strings never become keys.
  return Object.assign(read, {
    flush: (): Input[] => {
      if (dropping || held != '\x1b') return []
      held = ''
      return [{ name: 'escape' }]
    },
  })
}

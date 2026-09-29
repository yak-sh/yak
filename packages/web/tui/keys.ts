// The key tokens App.key() reads: the legacy bytes a terminal sends for the
// keys the app binds. @yaks/tui decodes the stream — the kitty protocol run.tsx
// asks for, legacy escapes, bracketed paste — into keys; this spells each one
// the way App.key() does, and drops a key the app doesn't bind, so a function
// key's escape never types into the command line.
import { decode, type Input, type Key } from '@yaks/tui'

// The arrows, spelled as a legacy terminal sends them.
let ARROWS: Record<string, string> = {
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
}

let token = (k: Input): string[] => {
  if (k.name == 'char') {
    if (k.ctrl && k.text == 'c') return ['\x03']
    if (k.ctrl && k.text == 'd') return ['\x04']
    return k.ctrl || k.alt ? [] : [...k.text ?? '']
  }
  if (k.name == 'paste') return [...k.text ?? '']
  if (k.name == 'enter') return [k.shift ? '\n' : '\r'] // ⇧⏎ is a newline
  if (k.name == 'escape') return ['\x1b']
  if (k.name == 'tab') return [k.shift ? '\x1b[Z' : '\t']
  if (k.name == 'backspace') return ['\x7f']
  if (k.name in ARROWS && !k.ctrl && !k.alt && !k.shift) {
    return [ARROWS[k.name]]
  }
  return []
}

/** A raw stdin chunk as the tokens App.key() reads. */
export let keys = (chunk: string): string[] => decode(chunk).flatMap(token)

/** A token as a browser names the key, for the query field (@yaks/filter
 * `press`): the keys its list answers. */
export let named: Record<string, string> = {
  '\t': 'Tab',
  '\r': 'Enter',
  '\x1b': 'Escape',
  [ARROWS.up]: 'ArrowUp',
  [ARROWS.down]: 'ArrowDown',
}

/** A token as an edit to a line of text (@yaks/tui `edit`): a character, a
 * backspace, or the caret stepping left or right. */
export let editing = (t: string): Key | undefined =>
  t == '\x7f'
    ? { name: 'backspace' }
    : t == ARROWS.left
    ? { name: 'left' }
    : t == ARROWS.right
    ? { name: 'right' }
    : t >= ' '
    ? { name: 'char', text: t }
    : undefined

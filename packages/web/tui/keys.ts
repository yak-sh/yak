// The key tokens App.key() reads: the legacy bytes a terminal sends for the
// keys the app binds. @yaks/tui decodes the stream — the kitty protocol run.tsx
// asks for, legacy escapes, bracketed paste — into keys; this spells each one
// the way App.key() does, and drops a key the app doesn't bind, so an arrow's
// `[A` never types into the command line.
import { decode, type Input } from '@yaks/tui'

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
  return []
}

/** A raw stdin chunk as the tokens App.key() reads. */
export let keys = (chunk: string): string[] => decode(chunk).flatMap(token)

// The key tokens: a raw stdin chunk becomes the tokens key() reads. The one
// that earns this is ⇧⏎ — a newline the terminal can only send under the kitty
// protocol, and the reason the TUI asks for it.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { keys } from './keys.ts'

let cases: [string, string, string[]][] = [
  ['⇧⏎ becomes a newline', '\x1b[13;2u', ['\n']],
  ['plain Enter stays a carriage return', '\x1b[13u', ['\r']],
  ['a raw CR passes through when the terminal never upgrades it', '\r', ['\r']],
  ['Escape comes back as itself', '\x1b[27u', ['\x1b']],
  ['⇧⇥ maps to the legacy shift-tab', '\x1b[9;2u', ['\x1b[Z']],
  ['Tab maps to a tab', '\x1b[9u', ['\t']],
  ['Backspace maps to DEL', '\x1b[127u', ['\x7f']],
  ['Ctrl-C maps to ETX', '\x1b[99;5u', ['\x03']],
  ['Ctrl-D maps to EOT', '\x1b[100;5u', ['\x04']],
  ['a plain letter passes straight through', 'j', ['j']],
  ['a typed run splits into its chars', 'abc', ['a', 'b', 'c']],
  ['legacy ⇧⇥ is still understood', '\x1b[Z', ['\x1b[Z']],
  ['an arrow keeps its legacy spelling', '\x1b[1;1A', ['\x1b[A']],
  ['a modified arrow is dropped', '\x1b[1;5A', []],
  ['an unbound key is dropped', '\x1b[H', []],
  ['an unbound modified key is dropped', '\x1b[65;5u', []],
  ['a raw Ctrl-C is ETX', '\x03', ['\x03']],
  ['a paste types its characters', '\x1b[200~a\nb\x1b[201~', ['a', '\n', 'b']],
]

test('keys maps terminal chunks to the keys the app binds', () => {
  for (let [what, chunk, want] of cases) {
    assertEquals(keys(chunk), want, what)
  }
})

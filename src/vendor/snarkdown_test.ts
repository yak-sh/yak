// The vendored snarkdown carries a local patch: intra-word underscores
// are literal, not emphasis. These tests are the patch's tripwire — if
// the file is ever re-vendored unpatched, they fail.
import { assertEquals } from '@std/assert'
import snarkdown from 'snarkdown'

let cases: [string, string][] = [
  ['foo_bar and then bar_baz', 'foo_bar and then bar_baz'],
  ['snake_case_name', 'snake_case_name'],
  ['a __very__ good _point_', 'a <strong>very</strong> good <em>point</em>'],
  ['_foo_bar_', '<em>foo_bar</em>'],
  ['**bold** and *em*', '<strong>bold</strong> and <em>em</em>'],
]

Deno.test('snarkdown: intra-word underscores stay literal', () => {
  for (let [md, html] of cases) assertEquals(snarkdown(md), html)
})

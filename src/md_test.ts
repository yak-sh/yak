// The markdown door's contract — the behaviors the app leans on. If a
// re-vendored marked or a config change breaks one, this says so.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { md } from './md.ts'

Deno.test('md: paragraphs are <p>, not a wall of <br>', () => {
  assertEquals(md('one\n\ntwo').trim(), '<p>one</p>\n<p>two</p>')
})

Deno.test('md: a single newline is a line break (breaks: true)', () => {
  assertStringIncludes(md('one\ntwo'), '<br')
})

Deno.test('md: intra-word underscores stay literal', () => {
  assertStringIncludes(md('foo_bar and bar_baz'), 'foo_bar and bar_baz')
  assertEquals(md('a _point_ made').trim(), '<p>a <em>point</em> made</p>')
})

Deno.test('md: gfm tables render', () => {
  let html = md('| a | b |\n| - | - |\n| 1 | 2 |')
  assertStringIncludes(html, '<table>')
  assertStringIncludes(html, '<td>1</td>')
})

Deno.test('md: fenced code with blank lines survives whole', () => {
  let html = md('```\none\n\ntwo\n```')
  assertStringIncludes(html, '<pre><code>one\n\ntwo')
})

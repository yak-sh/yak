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

Deno.test('md: a bare id auto-links with data-ref', () => {
  assertStringIncludes(
    md('see T-123 for the plan'),
    '<a href="/T-123" data-ref="T-123">T-123</a>',
  )
  assertStringIncludes(md('N-9 and P-19'), 'data-ref="N-9"')
})

Deno.test('md: a written link aims at an id', () => {
  assertStringIncludes(
    md('[my task idea](T-123)'),
    '<a href="/T-123" data-ref="T-123">my task idea</a>',
  )
  // a real url keeps marked's own anchor, untouched
  assertStringIncludes(md('[x](https://y.z)'), 'href="https://y.z"')
})

Deno.test('md: ids in code stay literal; mid-word letters stay words', () => {
  assertEquals(md('`T-123`').includes('data-ref'), false)
  assertEquals(md('```\nT-123\n```').includes('data-ref'), false)
  assertEquals(md('UTF-8 and SHA-256').includes('data-ref'), false)
  // an unknown prefix is not a reference
  assertEquals(md('X-123').includes('data-ref'), false)
})

import { assertEquals, assertStringIncludes } from '@std/assert'
import { html, linkable, text } from './md.ts'

Deno.test('html: markup a body wrote is text, never markup', () => {
  assertEquals(
    html('<script>alert(1)</script>'),
    '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
  )
  assertEquals(html('a & b'), '<p>a &amp; b</p>')
})

Deno.test('html: an href is judged by its shape', () => {
  assertStringIncludes(
    html('[sign up](https://books.example/potluck)'),
    '<a href="https://books.example/potluck">sign up</a>',
  )
  assertStringIncludes(
    html('[mail](mailto:ana@books.example)'),
    '<a href="mailto:',
  )
  // A scheme that survives entity decoding, and a relative link a mail client
  // has no base document for: both render as their words.
  assertEquals(html('[x](javascript&colon;alert)'), '<p>x</p>')
  assertEquals(html('[x](javascript:alert)'), '<p>x</p>')
  assertEquals(html('[the list](/list)'), '<p>the list</p>')
  assertEquals(linkable('https://x.example'), true)
  assertEquals(linkable('/list'), false)
})

Deno.test('html: the blocks it knows', () => {
  assertEquals(html('# Potluck'), '<h1>Potluck</h1>')
  assertEquals(html('- bread\n- soup'), '<ul><li>bread</li><li>soup</li></ul>')
  assertEquals(html('one\ntwo'), '<p>one<br>two</p>')
  assertEquals(html('one\n\ntwo'), '<p>one</p>\n<p>two</p>')
  assertEquals(
    html('**a** *b* `c`'),
    '<p><strong>a</strong> <em>b</em> <code>c</code></p>',
  )
})

Deno.test('text: the words stay, a link keeps its address', () => {
  assertEquals(
    text('Potluck **Friday** — [sign up](https://books.example/p)'),
    'Potluck Friday — sign up (https://books.example/p)',
  )
  assertEquals(text('# Potluck\n\n- bread'), 'Potluck\n\n- bread')
  assertEquals(text('<b>hi</b>'), '<b>hi</b>')
})

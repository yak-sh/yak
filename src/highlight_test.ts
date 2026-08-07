// One tokenizer feeds HTML and terminal segments; both keep the source while
// explicit and inferred languages add only the library's semantic classes.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { highlight } from './highlight.ts'

Deno.test('highlight: a specified language colors code and preserves text', () => {
  let lit = highlight("let name: string = 'Ada'", 'typescript')
  assertEquals(lit.language, 'typescript')
  assertStringIncludes(lit.html, 'hljs-keyword')
  assertStringIncludes(lit.html, 'hljs-string')
  assertEquals(
    lit.lines.flat().map((t) => t.text).join(''),
    "let name: string = 'Ada'",
  )
})

Deno.test('highlight: an absent language is detected', () => {
  let lit = highlight(
    '#!/usr/bin/env python3\ndef greet(name):\n    print(f"hello {name}")',
  )
  assertEquals(lit.language, 'python')
  assertStringIncludes(lit.html, 'hljs-keyword')
})

Deno.test('highlight: an unknown language stays escaped plain code', () => {
  let lit = highlight('<script>alert(1)</script>', 'not-a-language')
  assertEquals(lit.language, undefined)
  assertEquals(lit.html, '&lt;script&gt;alert(1)&lt;/script&gt;')
  assertEquals(
    lit.lines.flat().map((t) => t.text).join(''),
    '<script>alert(1)</script>',
  )
})

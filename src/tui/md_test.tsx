// Terminal markdown wears the same syntax scopes as HTML, with the painter as
// the only source of ANSI bytes.
import './dom.ts'
import { render } from 'preact'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { TElement } from './dom.ts'
import { Md } from './md.tsx'
import { ansi, pane } from './paint.ts'

let painted = (text: string) => {
  let root = new TElement('root')
  render(<Md text={text} />, root as unknown as Parameters<typeof render>[1])
  return pane(root).lines.map(ansi).join('\n')
}

Deno.test('terminal markdown highlights specified fenced code', () => {
  let out = painted("```ts\nlet name: string = 'Ada'\n```")
  assertStringIncludes(out, '\x1b[38;2;230;126;128mlet\x1b[0m')
  assertStringIncludes(out, "\x1b[38;2;167;192;128m'Ada'\x1b[0m")
  let visible = out.split('\x1b').map((part, i) =>
    i ? part.replace(/^\[[\d;]+m/, '') : part
  ).join('')
  assertStringIncludes(
    visible,
    "let name: string = 'Ada'",
  )
})

Deno.test('terminal markdown detects unlabelled tilde fences', () => {
  let out = painted(
    '~~~\n#!/usr/bin/env python3\ndef greet(name):\n    print(name)\n~~~',
  )
  assertStringIncludes(out, '\x1b[38;2;230;126;128mdef\x1b[0m')
})

Deno.test('terminal markdown detects indented code blocks', () => {
  let out = painted(
    '    #!/usr/bin/env python3\n    def greet(name):\n        print(name)',
  )
  assertStringIncludes(out, '\x1b[38;2;230;126;128mdef\x1b[0m')
})

Deno.test('terminal highlighted code cannot speak ANSI', () => {
  let out = painted('```js\nlet x = "\x1b]52;c;QQ==\x07"\n```')
  assertEquals(out.includes('\x1b]52'), false)
  assertStringIncludes(out, ']52;c;QQ==')
})

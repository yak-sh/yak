// Terminal markdown wears the same syntax scopes as HTML, with the painter as
// the only source of ANSI bytes.
import { test } from '@yaks/testing'
import './doc.ts'
import { render } from 'preact'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { ansi, TElement } from '@yaks/tui'
import { Md } from './md.tsx'
import { pane } from './paint.ts'

let painted = (text: string) => {
  let root = new TElement('root')
  render(<Md text={text} />, root as unknown as Parameters<typeof render>[1])
  return pane(root).lines.map(ansi).join('\n')
}

// A token wears its colour, on whatever ground the code is set on.
let wears = (out: string, rgb: string, token: string) =>
  assert(
    new RegExp(`\x1b\\[38;2;${rgb}[;\\d]*m${token}\x1b\\[0m`).test(out),
    token,
  )

// Every case here renders <Md> through preact and highlights the fence with
// hljs (grammar compile, and auto-detection when no language is named).
test('terminal markdown highlights specified fenced code', () => {
  let out = painted("```ts\nlet name: string = 'Ada'\n```")
  wears(out, '230;126;128', 'let')
  wears(out, '167;192;128', "'Ada'")
  let visible = out.split('\x1b').map((part, i) =>
    i ? part.replace(/^\[[\d;]+m/, '') : part
  ).join('')
  assertStringIncludes(
    visible,
    "let name: string = 'Ada'",
  )
})

test('terminal markdown detects unlabelled tilde fences', () => {
  let out = painted(
    '~~~\n#!/usr/bin/env python3\ndef greet(name):\n    print(name)\n~~~',
  )
  wears(out, '230;126;128', 'def')
})

test('terminal markdown detects indented code blocks', () => {
  let out = painted(
    '    #!/usr/bin/env python3\n    def greet(name):\n        print(name)',
  )
  wears(out, '230;126;128', 'def')
})

test('terminal highlighted code cannot speak ANSI', () => {
  let out = painted('```js\nlet x = "\x1b]52;c;QQ==\x07"\n```')
  assertEquals(out.includes('\x1b]52'), false)
  assertStringIncludes(out, ']52;c;QQ==')
})

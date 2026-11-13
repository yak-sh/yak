/** @jsxImportSource preact */
// Markdown in browse: @yaks/markdown drawn in the face its caller chooses,
// its ids leading to their pages and its commits to their repository.
import { test } from '@yaks/testing'
import '../testing.ts'
import { assertEquals } from '@std/assert'
import { type ComponentChildren, render } from 'preact'
import { parseHTML } from 'linkedom'
import { Markdown, MarkdownHost } from './Markdown.tsx'
import { Markdown as Shared } from '@yaks/markdown'
import { el } from '@yaks/ui'

let Face = el('article', 'Prose')
let REPO = 'https://github.com/acme/widget'

// Draws `node` into a document of its own, and hands back its root.
let drawn = (node: ComponentChildren) => {
  let { document } = parseHTML('<main></main>')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  try {
    render(<>{node}</>, root)
    return root
  } finally {
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
}

// What a reader sees of some prose: each anchor as `[words](href)`, marked
// `@` where it carries the id nav.tsx opens in the app.
let seen = (text: string, repo?: string) => {
  let root = drawn(<Markdown text={text} repo={repo} />)
  for (let a of [...root.querySelectorAll('a')]) {
    let ref = a.getAttribute('data-ref') ? '@' : ''
    a.replaceWith(`${ref}[${a.textContent}](${a.getAttribute('href')})`)
  }
  return root.textContent!.trim()
}

test('markdown fills the chosen face and forwards its props', () => {
  let root = drawn(
    <Markdown as={Face} text='**hello** there' data-note='kept' />,
  )
  let face = root.querySelector('.Prose')!
  assertEquals(face.tagName, 'ARTICLE')
  assertEquals(face.getAttribute('data-note'), 'kept')
  assertEquals(
    face.querySelector('p.Body_Paragraph strong')?.textContent,
    'hello',
  )
})

test('ids lead to their pages and commits to their repository', () => {
  let sha = 'a'.repeat(40)
  for (
    let [text, want, repo] of [
      ['see T-123.', 'see @[T-123](/T-123).'],
      ['short #18bc9a78d1', 'short @[#18bc9a78d1](/18bc9a78d1)'],
      ['[the plan](M-4)', '@[the plan](/M-4)'],
      [`commit ${sha}`, `commit @[${sha}](/${sha})`],
      ['`46dcd3f`', `@[46dcd3f](${REPO}/commit/46dcd3f)`, REPO],
      ['`46dcd3f` without a repo', '46dcd3f without a repo'],
      ['`46dcd3f`', '46dcd3f', 'javascript:alert(1)'],
      ['`T-5` and UTF-8', 'T-5 and UTF-8'],
      ['| a |\n|---|\n| T-9 |', 'a@[T-9](/T-9)'],
    ]
  ) assertEquals(seen(text, repo), want, text)
})

test('fenced code is coloured, and markup a body wrote stays words', () => {
  let text = '```ts\nlet x = 1\n```\n\n<script>bad()</script>'
  let root = drawn(<Markdown text={text} />)
  assertEquals(root.querySelector('pre code .hljs-keyword')?.textContent, 'let')
  assertEquals(root.querySelector('script'), null)
  assertEquals(root.textContent!.includes('<script>bad()</script>'), true)
})

test('a title flattens its links and ids to words', () => {
  let root = drawn(
    <Markdown text='Fix [the map](https://x.test) for T-1' inline />,
  )
  assertEquals(root.querySelector('a'), null)
  assertEquals(root.textContent, 'Fix the map for T-1')
})

// Pages browse did not draw itself, such as a topic's or a task's inspect
// page, draw @yaks/markdown under browse's host, and their ids link too.
test('every Markdown under browse links its ids', () => {
  let root = drawn(
    <MarkdownHost>
      <Shared source='the role, Q-161016' />
    </MarkdownHost>,
  )
  let a = root.querySelector('a[data-ref]')
  assertEquals(a?.getAttribute('href'), '/Q-161016')
  assertEquals(drawn(<Shared source='Q-1' />).querySelector('a'), null)
})

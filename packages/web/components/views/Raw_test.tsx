// Raw views keep their source inert while presenting it as highlighted code.
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import type { Ent } from '../../types.ts'
import { Json } from './Json.tsx'
import { Md } from './Md.tsx'

let ent = (body: string): Ent => ({
  eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  num: 1,
  kind: 'doc',
  refs: [],
  kids: [],
  doc: { eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Raw', body },
})

let html = (View: typeof Json, body: string) => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  try {
    render(h(View, { e: ent(body) }), root)
    return root.innerHTML
  } finally {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
}

Deno.test('JSON renders highlighted code inside pre', () => {
  let { document } = parseHTML(html(Json, '<script>alert(1)</script>'))
  let root = document
  let code = root.querySelector('.Json > code')
  assertEquals(code?.className, 'hljs language-json')
  assertEquals(
    [...(code?.querySelectorAll('.hljs-attr') ?? [])].some((x) =>
      x.textContent == '"title"'
    ),
    true,
  )
  assertEquals(root.querySelector('script'), null)
  assertEquals(code?.textContent.includes('<script>alert(1)</script>'), true)
})

Deno.test('Markdown renders highlighted code inside pre', () => {
  let { document } = parseHTML(
    html(Md, '# heading\n\n<script>alert(1)</script>'),
  )
  let root = document
  let code = root.querySelector('.Md > code')
  assertEquals(code?.className, 'hljs language-markdown')
  assertEquals(
    [...(code?.querySelectorAll('.hljs-section') ?? [])].some((x) =>
      x.textContent == '# heading'
    ),
    true,
  )
  assertEquals(root.querySelector('script'), null)
  assertEquals(code?.textContent.includes('<script>alert(1)</script>'), true)
})

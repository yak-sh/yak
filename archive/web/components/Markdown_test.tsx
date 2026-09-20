// Markdown owns the DOM injection while its caller keeps the element that
// participates in layout and interaction.
import { assertEquals } from '@std/assert'
import { render } from 'preact'
import { parseHTML } from 'linkedom'
import { Markdown } from './Markdown.tsx'
import { el } from './ui.tsx'

let Face = el('article', 'Prose')

Deno.test('markdown fills the chosen face and forwards its props', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  try {
    render(
      <Markdown
        as={Face}
        text='**hello** `46dcd3f`'
        repo='https://github.com/acme/widget'
        data-note='kept'
      />,
      root,
    )
    let face = root.querySelector('.Prose')!
    assertEquals(face.tagName, 'ARTICLE')
    assertEquals(face.getAttribute('data-note'), 'kept')
    assertEquals(face.querySelector('strong')?.textContent, 'hello')
    assertEquals(
      face.querySelector('a')?.getAttribute('href'),
      'https://github.com/acme/widget/commit/46dcd3f',
    )
    render(<Markdown text='hello *there*' inline />, root)
    assertEquals(root.innerHTML, '<div>hello <em>there</em></div>')
  } finally {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

// The icon vocabulary keeps Lucide behind one stable, data-driven component.
import { render } from 'preact'
import { assertEquals, assertExists } from '@std/assert'
import { parseHTML } from 'linkedom'
import { Icon } from './icons.tsx'

let svg = (name: string, size?: number) => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  try {
    render(<Icon name={name} size={size} />, root)
    return root.querySelector('svg')!
  } finally {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
}

Deno.test('icons keep the app contract around Lucide', () => {
  let icon = svg('search', 18)
  assertExists(icon.querySelector('circle'))
  assertEquals(icon.getAttribute('class'), 'lucide lucide-search Icon')
  assertEquals(icon.getAttribute('width'), '18')
  assertEquals(icon.getAttribute('height'), '18')
  assertEquals(icon.getAttribute('stroke'), 'currentColor')
  assertEquals(icon.getAttribute('aria-hidden'), 'true')
})

Deno.test('unknown icon names keep the document fallback', () => {
  let icon = svg('future-view')
  assertEquals(icon.getAttribute('class'), 'lucide lucide-file-text Icon')
  assertEquals(icon.getAttribute('width'), '14')
})

Deno.test('the rejection icon survives the vocabulary migration', () => {
  let icon = svg('circle-x')
  assertEquals(icon.getAttribute('class'), 'lucide lucide-circle-x Icon')
})

Deno.test('the sidebar menu has its own icon', () => {
  let icon = svg('menu')
  assertEquals(icon.getAttribute('class'), 'lucide lucide-menu Icon')
})

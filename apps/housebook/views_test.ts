import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { view } from './views.js'

let { document, window } = parseHTML('<html><body></body></html>')
let original = Object.getOwnPropertyDescriptor(globalThis, 'document')
let opened = ''
let files = [
  {
    entity: { eid: 'manual' },
    doc: { title: 'Care manual', body: 'Keep the warranty receipt.' },
    house_file: { item: 'furnace', blob: 'pdf', mime: 'application/pdf' },
  },
  {
    entity: { eid: 'reference' },
    doc: { title: 'Building codes', body: 'Saved reference notes.' },
    house_file: { url: 'https://example.org/codes' },
  },
]
let list
try {
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let screens = view({
    data: {
      house_file: files,
      house_item: [{ entity: { eid: 'furnace' }, doc: { title: 'Furnace' } }],
    },
    who: { writes: false },
    open: (eid: string) => {
      opened = eid
    },
    edit: () => {},
    navigate: () => {},
    complete: () => {},
    remove: () => {},
    handover: () => {},
    select: () => {},
    selected: new Set(),
  })
  list = screens.docs(files)
} finally {
  if (original) Object.defineProperty(globalThis, 'document', original)
  else Reflect.deleteProperty(globalThis, 'document')
}
let rows = list.querySelectorAll('.list-row')
let appliance = rows[0].querySelector('.related-item a')!

test('a document keeps its appliance and notes independently visible', () => {
  assertEquals(appliance.textContent, 'Furnace')
  assertEquals(
    rows[0].querySelector('.document-notes')?.textContent,
    'Keep the warranty receipt.',
  )
  appliance.dispatchEvent(new window.Event('click', { cancelable: true }))
  assertEquals(opened, 'furnace')
})

test('document rows distinguish hosted PDFs and ordinary website references', () => {
  assertEquals(rows[0].querySelector('.file-icon')?.textContent, 'PDF')
  assertEquals(rows[1].querySelector('.file-icon')?.textContent, '↗')
  assertEquals(
    rows[1].querySelector('.related-item')?.textContent,
    'House reference',
  )
  assertEquals(
    rows[1].querySelector('.document-notes')?.textContent,
    'Saved reference notes.',
  )
})

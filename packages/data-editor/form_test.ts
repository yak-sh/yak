import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { controls, stamp } from './form.js'

let { document } = parseHTML('<html><body></body></html>')
let doc = document as unknown as Document

test('a stamp is the kit date face without a ticking component', () => {
  let at = '2026-11-06T15:42:00Z'
  let node = stamp(doc, at)
  equal(node.tagName, 'TIME')
  equal(node.getAttribute('datetime'), at)
  equal(node.getAttribute('data-tip')?.startsWith('Nov 6th, 2026'), true)
  equal(node.hasAttribute('title'), false)
})

test('an address field holds a file beside the page, which a url field refuses', async () => {
  let { drawControl } = controls({ doc, client: {}, files: '', accepts: null })
  let field = await drawControl(
    { comp: 'product', prop: 'image', label: 'Image', control: 'url' },
    'image',
    'tee-charcoal.svg',
    true,
    () => {},
  )
  let input = field.querySelector('input') ?? field
  equal(input.getAttribute('type'), 'text')
  equal(input.getAttribute('inputmode'), 'url')
  equal(input.value, 'tee-charcoal.svg')
})

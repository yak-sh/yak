import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { stamp } from './form.js'

let { document } = parseHTML('<html><body></body></html>')

test('a stamp is the kit date face without a ticking component', () => {
  let at = '2026-11-06T15:42:00Z'
  let node = stamp(document as unknown as Document, at)
  equal(node.tagName, 'TIME')
  equal(node.getAttribute('datetime'), at)
  equal(node.getAttribute('data-tip')?.startsWith('Nov 6th, 2026'), true)
  equal(node.hasAttribute('title'), false)
})

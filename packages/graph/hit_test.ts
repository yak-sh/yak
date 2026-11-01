import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { hit, snippet } from './hit.ts'

let vocab = loadVocab({
  $defs: {
    doc: {
      component: true,
      kind: true,
      properties: {
        title: { type: 'string', search: true },
        body: { type: 'string', search: true },
      },
    },
  },
})
let repeated = 'Café dragon, in the vale. '.repeat(25_000)
let late = 'padding '.repeat(100) + '𝓐lpha Café dragon ends here'
let row = {
  entity: { eid: 'transcript' },
  doc: { title: 'Dragon', body: repeated },
}

test('a title-only search excerpt shows a marked body window of a large transcript', () => {
  equal(
    hit(vocab, ['dragon'])(row, '\x01Dragon\x02').snippet,
    snippet(repeated.slice(0, 500), ['dragon']),
  )
})
test('a snippet finds a late phrase across punctuation and marks only its window', () => {
  equal(
    snippet(late, ['"𝓐lpha Café"', 'dragon']),
    '…padding padding padding padding padding padding padding padding \x01𝓐lpha Café\x02 \x01dragon\x02 ends here',
  )
})
test('a meaning excerpt is kept without reading the body for another excerpt', () => {
  equal(
    hit(vocab, ['dragon'])(row, 'A mythic creature').snippet,
    'A mythic creature',
  )
})

test('an unbroken transcript keeps a bounded excerpt', () => {
  equal(snippet('dragon'.repeat(25_000), ['dragon']).length < 220, true)
})

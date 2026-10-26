import { test } from '@yaks/testing'
import { assert, assertFalse } from '@std/assert'
import { handover } from './export.js'

let data = {
  house_profile: [{
    doc: { title: 'Home', body: 'Welcome' },
    house_profile: {},
  }],
  house_item: [
    {
      entity: { eid: 'a' },
      doc: { title: 'Furnace', body: '<script>unsafe</script>' },
      house_item: { category: 'Heating & cooling' },
    },
    {
      entity: { eid: 'b' },
      doc: { title: 'Private policy' },
      house_item: { category: 'Insurance & property' },
    },
  ],
  house_file: [
    {
      entity: { eid: 'f' },
      doc: { title: 'Installation' },
      house_file: { item: 'a', blob: 'hash' },
    },
    {
      entity: { eid: 'g' },
      doc: { title: 'Policy PDF' },
      house_file: { item: 'b', url: 'https://example.org/private' },
    },
  ],
  house_record: [{
    doc: { title: 'Service call' },
    house_record: { item: 'a', date: '2026-10-01', cost: 50 },
  }],
  house_contact: [{ doc: { title: 'Private contractor' } }],
  house_circuit: [],
}

test('a handover contains only selected items and embeds their uploaded documents', () => {
  let page = handover(
    data,
    new Set(['a']),
    false,
    new Map([['f', 'data:application/pdf;base64,YQ==']]),
  )
  assert(page.includes('Furnace'))
  assert(page.includes('data:application/pdf;base64,YQ=='))
  assert(page.includes('&lt;script&gt;unsafe&lt;/script&gt;'))
  for (
    let excluded of [
      'Private policy',
      'Policy PDF',
      'Private contractor',
      'Service call',
      '<script>',
    ]
  ) assertFalse(page.includes(excluded))
})

test('a handover includes maintenance history only when requested', () => {
  let page = handover(data, new Set(['a']), true)
  assert(page.includes('Service call'))
  assert(page.includes('$50'))
})

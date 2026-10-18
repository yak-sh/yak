import { equal, test } from '@yaks/testing'
import { categories, escapeHTML, ingredients } from './model.js'

const rows = [
  {
    entity: { eid: 'a' },
    doc: { title: 'One' },
    recipe: { category: 'Sides', ingredients: '1 cup flour\n\nSalt' },
  },
  {
    entity: { eid: 'b' },
    doc: { title: 'Two' },
    recipe: { category: 'Sides', ingredients: '2 g salt' },
  },
  {
    entity: { eid: 'c' },
    doc: { title: '<Three>' },
    recipe: { ingredients: '' },
  },
]
test('recipe categories keep a single group for a shared category and include unsorted cards', () => {
  equal(categories(rows), ['Sides', 'Unsorted'])
})
test('ingredient list reads only the selected cards and preserves their actual quantities', () => {
  equal(ingredients(rows, new Set(['a'])), [{
    title: 'One',
    lines: ['1 cup flour', 'Salt'],
  }])
  equal(ingredients(rows, new Set()), [])
})
test('live recipe titles are escaped rather than interpreted as page markup', () => {
  equal(
    escapeHTML('<img src="x" onerror=\'bad\'> &'),
    '&lt;img src=&quot;x&quot; onerror=&#39;bad&#39;&gt; &amp;',
  )
})

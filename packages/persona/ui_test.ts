// The name card as a browser reads it: one field holding the name now, no
// longer than a name may be.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { equal, test } from '@yaks/testing'
import { LONGEST } from './name.ts'
import { NameCard } from './ui.ts'

test('the name card holds the name now, as long as a name may be', () => {
  let { document } = parseHTML(renderToString(h(NameCard, { name: 'Elihu' })))
  let field = document.querySelector('input[name=name]')!
  equal(document.querySelector('h2')?.textContent, 'Name')
  equal(document.querySelector(`label[for="${field.id}"]`)?.textContent, 'Name')
  equal(
    [field.getAttribute('value'), field.getAttribute('maxlength')],
    ['Elihu', String(LONGEST)],
  )
  equal(field.hasAttribute('required'), true)
})

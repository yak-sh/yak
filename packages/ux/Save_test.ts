import { equal, test } from '@yaks/testing'
import { Field, Form } from '@yaks/ui/parts'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { Save } from './Save.ts'

test('a controlled changed field keeps the same label and control markup', () => {
  let draw = (changed: boolean) =>
    parseHTML(renderToString(
      h(
        Save.Field,
        { as: Form.Field, changed },
        h(Form.Label, { for: 'name' }, 'Name'),
        h(Field, { id: 'name', value: 'A name' }),
      ),
    )).document.querySelector('.Save_Field')!
  let clean = draw(false), changed = draw(true)
  equal(changed.hasAttribute('data-changed'), true)
  equal(clean.hasAttribute('data-changed'), false)
  equal(changed.innerHTML, clean.innerHTML)
  equal(changed.firstElementChild?.textContent, 'Name')
})

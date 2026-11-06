import { equal, test } from '@yaks/testing'
import { confirms } from './act.ts'
import type { Control } from './touch.ts'

let control = (name: string, more: Partial<Control> = {}): Control => ({
  ref: 'e1',
  role: 'button',
  name,
  ...more,
})
let asks = (tool: string, c?: Control, args: Record<string, unknown> = {}) =>
  confirms({ id: 'c', tool, args }, c)

test('a click that submits, or whose words weigh, waits for Do it', () => {
  equal(
    [
      asks('browser_click', control('Next')),
      asks('browser_click', control('Go', { submits: true })),
      asks('browser_click', control('Send message')),
      asks('browser_click', control('Delete account')),
      asks('browser_click', control('Pay now')),
      asks('browser_click', control('Publish')),
    ],
    [false, true, true, true, true, true],
  )
})

test('Enter waits for Do it unless the field is a search, and typing alone never', () => {
  let field = control('Message', { role: 'textbox' })
  let search = control('Search', { role: 'searchbox', search: true })
  equal(
    [
      asks('browser_type', field),
      asks('browser_type', field, { enter: true }),
      asks('browser_type', search, { enter: true }),
      asks('browser_type', control('Post a reply', { search: true }), {
        enter: true,
      }),
    ],
    [false, true, false, true],
  )
})

test("the agent's word adds a question and never removes one", () => {
  equal(
    [
      asks('browser_click', control('Next'), { confirm: true }),
      asks('browser_navigate', undefined, { confirm: true }),
      asks('browser_navigate', undefined, {}),
      asks('browser_click', control('Buy', { submits: true }), {
        confirm: false,
      }),
    ],
    [true, true, false, true],
  )
})

/** Native keyboard events, focus, selection and form submission in a fake DOM. */
import { equal, ok, test } from '@yaks/testing'
import { dispatch, install, TElement } from './dom.ts'
import { event, interaction } from './interaction.ts'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'

test('terminal keyboard activates an anchor, edits its native field and submits the form', async () => {
  let screen = install()
  let typed = '', sent = '', opened = ''
  let keys = interaction(screen.root, (href) => opened = href)
  let target = screen.root as unknown as Parameters<typeof render>[1]
  try {
    await act(() =>
      render(
        h(
          'div',
          {},
          h('a', { href: '/T-1' }, 'One'),
          h(
            'form',
            {
              onSubmit: (e: Event) => {
                e.preventDefault()
                sent = typed
              },
            },
            h('textarea', {
              value: '',
              onInput: (e: Event) =>
                typed = (e.target as unknown as TElement).value,
            }),
          ),
        ),
        target,
      )
    )
    keys.press({ name: 'tab' })
    keys.press({ name: 'enter' })
    equal(opened, '/T-1')
    keys.press({ name: 'tab' })
    keys.press({ name: 'char', text: 'Kept words' })
    keys.press({ name: 'enter', shift: true })
    keys.press({ name: 'char', text: 'next line' })
    equal(typed, 'Kept words\nnext line')
    keys.press({ name: 'escape' })
    equal(screen.root.querySelector('[data-caret]'), null)
    keys.focus(screen.root.querySelector('textarea')!)
    keys.press({ name: 'enter' })
    equal(sent, 'Kept words\nnext line')
  } finally {
    render(null, target)
    screen.free()
  }
})
test('fake DOM sends capture before target and bubble and supports listener removal', () => {
  let root = new TElement('div'), child = new TElement('button')
  root.appendChild(child)
  let seen: string[] = []
  root.handlers.set('clickCapture', () => seen.push('capture'))
  root.addEventListener('click', () => seen.push('bubble'))
  let listener = () => {
    seen.push('target')
  }
  child.addEventListener('click', listener)
  dispatch(child, new Event('click', { bubbles: true, cancelable: true }))
  equal(seen, ['capture', 'target', 'bubble'])
  child.removeEventListener('click', listener)
  seen = []
  event(child, 'click')
  equal(seen, ['capture', 'bubble'])
  ok(root.querySelector('button') == child)
})

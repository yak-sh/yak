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
test('j walks past a select and a checkbox to the text box, and arrows choose', async () => {
  let screen = install()
  let model = '', keys = interaction(screen.root, () => {})
  let target = screen.root as unknown as Parameters<typeof render>[1]
  let at = () => keys.active()?.localName ?? ''
  try {
    await act(() =>
      render(
        h(
          'div',
          {},
          h(
            'select',
            {
              value: '',
              onChange: (e: Event) =>
                model = (e.target as unknown as TElement).value,
            },
            h('option', { value: '' }, 'current'),
            h('option', { value: 'opus' }, 'Opus'),
          ),
          h('input', { type: 'checkbox' }),
          h('textarea', { value: '' }),
        ),
        target,
      )
    )
    keys.press({ name: 'char', text: 'j' })
    equal(at(), 'select')
    keys.press({ name: 'right' })
    keys.press({ name: 'right' })
    equal(model, 'opus')
    keys.press({ name: 'left' })
    equal(model, '')
    keys.press({ name: 'char', text: 'j' })
    equal(at(), 'input')
    keys.press({ name: 'char', text: 'j' })
    equal(at(), 'textarea')
    keys.press({ name: 'char', text: 'k' })
    equal(at(), 'textarea')
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

test('a remounted field types at its restored caret', () => {
  let root = new TElement('div')
  let keys = interaction(root, () => {})
  let field = new TElement('input')
  field.value = 'left right'
  root.appendChild(field)
  keys.focus(field)
  field.setSelectionRange(5, 5)
  root.removeChild(field)
  let remounted = new TElement('input')
  remounted.value = field.value
  remounted.setSelectionRange(field.selectionStart, field.selectionEnd)
  root.appendChild(remounted)
  remounted.focus()
  try {
    equal(remounted.attr('data-caret'), '5')
    keys.press({ name: 'char', text: 'new ' })
    equal(remounted.value, 'left new right')
    equal(remounted.selectionStart, 9)
    equal(remounted.attr('data-caret'), '9')
  } finally {
    remounted.blur()
  }
})

// A palette may unmount before the next shortcut arrives. Its old input
// cannot keep the shortcut from choosing the newly mounted composer.
test('a detached field no longer owns focus when a shortcut chooses its target', () => {
  let root = new TElement('div')
  let keys = interaction(root, () => {})
  let palette = new TElement('input')
  root.appendChild(palette)
  keys.focus(palette)
  root.removeChild(palette)
  let composer = new TElement('textarea')
  root.appendChild(composer)
  try {
    equal(keys.active(), null)
    keys.focus(composer)
    keys.press({ name: 'char', text: 'hello' })
    equal(composer.value, 'hello')
    equal(keys.active(), composer)
    equal(palette.value, '')
  } finally {
    composer.blur()
  }
})

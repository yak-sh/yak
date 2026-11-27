import { install } from '@yaks/dom'
import { equal, test } from '@yaks/testing'
import { createElement as h } from 'react'
import { surface } from './draw.ts'

test('a drawn view updates and receives events in the in-memory tree', () => {
  let screen = install()
  let view = surface(screen.root as unknown as Element)
  let presses = 0
  try {
    let press = () => {
      presses++
    }
    view.draw(h('button', { className: 'Kit', onClick: press }, 'First'))
    let button = screen.root.querySelector('button')!
    equal([button.className, button.textContent], ['Kit', 'First'])
    view.draw(h('button', { className: 'Kit', onClick: press }, 'Second'))
    equal(screen.root.querySelector('button') === button, true)
    equal(button.textContent, 'Second')
    button.click()
    equal(presses, 1)
  } finally {
    view.close()
    screen.free()
  }
  equal(screen.root.textContent, '')
})

test('a drawn select keeps its controlled choice in the painted tree', () => {
  let screen = install()
  let view = surface(screen.root as unknown as Element)
  let choose = (value: string) =>
    h(
      'select',
      { value, onChange: () => {} },
      h('option', { value: 'a' }, 'One'),
      h('option', { value: 'b' }, 'Two'),
    )
  try {
    view.draw(choose('a'))
    equal(screen.root.querySelector('select')?.value, 'a')
    view.draw(choose('b'))
    equal(screen.root.querySelector('select')?.value, 'b')
    equal(screen.root.querySelector('option[selected]')?.textContent, 'Two')
  } finally {
    view.close()
    screen.free()
  }
})

/** A text field keeps what is typed in it and its caret while its value is
 * drawn again, and moves the caret with the text when a new value arrives. */
import { equal, test, typist } from '@yaks/testing'
import { signal } from '@preact/signals'
import { parseHTML } from 'linkedom'
import { createElement as h } from 'react'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { renderToString } from 'preact-render-to-string'
import { Field, moved } from './Field.ts'

test('an offset stays before the change, moves after it, and goes to the end of a span it was inside', () => {
  let cases: [string, string, number, number][] = [
    ['Find the recipe', 'Find the recipe please', 4, 4],
    ['Find the recipe', 'Please find the recipe', 4, 11],
    ['Find the recipe', 'Find a recipe', 6, 6],
    ['Find the recipe', 'Find the recipe', 9, 9],
    ['', 'From the phone', 0, 0],
  ]
  for (let [was, now, at, to] of cases) equal(moved(was, now, at), to)
})

// A field drawn from a value as an owner keeps it, on a page whose textarea
// keeps its caret as a browser does.
let field = (value = '') => {
  let { document } = parseHTML('<html><body><div id="f"></div></body></html>')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let text = signal(value)
  let root = document.getElementById('f')!
  let Owner = () =>
    h(Field, {
      placeholder: 'Write a sentence…',
      lines: true,
      value: text.value,
      onInput: (e: Event) =>
        text.value = (e.currentTarget as HTMLTextAreaElement).value,
    })
  let draw = () => render(h(Owner, {}), root)
  act(draw)
  let el = root.querySelector('textarea')!
  let t = typist(el)
  return {
    el,
    t,
    text,
    // where it stands: what it shows and where its caret is
    shows: () => [el.value, el.selectionStart],
    set: (v: string) => act(() => void (text.value = v)),
    draw: () => act(draw),
    [Symbol.dispose]: () => {
      render(null, root)
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else Reflect.deleteProperty(globalThis, 'document')
    },
  }
}

test('typing in the middle keeps the caret there as the field is drawn again', () => {
  using f = field('Find the recipe')
  f.t.at(4)
  act(() => f.t.type(' me'))
  f.draw()
  equal(f.shows(), ['Find me the recipe', 7])
})

test('a value from elsewhere moves the caret with the text around it', () => {
  using f = field('Find the recipe')
  f.t.at(4)
  f.set('Find the recipe, please')
  equal(f.shows(), ['Find the recipe, please', 4])
  f.set('Please find the recipe, please')
  equal(f.shows(), ['Please find the recipe, please', 11])
  f.t.at(4, 9)
  f.set('So, please find the recipe, please')
  equal([f.el.selectionStart, f.el.selectionEnd], [8, 13])
})

test('a value arriving while a word is composed waits until it ends', () => {
  using f = field('Find the recipe')
  f.t.at(4)
  act(() => f.t.compose(' m'))
  f.set('Find m the recipe, please')
  equal(f.shows(), ['Find m the recipe', 6])
  act(() => f.t.end())
  equal(f.shows(), ['Find m the recipe, please', 6])
})

test('a field given only a defaultValue shows it, drawn on the server', () => {
  let shown = (lines: boolean) =>
    parseHTML(
      renderToString(
        h(Field, {
          lines,
          placeholder: 'Write a sentence…',
          defaultValue: 'A fox',
        }),
      ),
    )
      .document.querySelector(lines ? 'textarea' : 'input')!
  equal(shown(true).textContent, 'A fox')
  equal(shown(false).getAttribute('value'), 'A fox')
})

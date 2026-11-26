// The box a key is pasted in, as a live page draws it: asked for while the
// connection needs a key or its last was refused, gone once it is connected;
// what was typed goes to `save`, and the box is emptied.
import { test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { KeyForm, type Pasted } from './form.ts'

let drawn = (status: string) => {
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  let saved: Pasted[] = []
  render(
    h(KeyForm, {
      id: 'c',
      title: 'Key for Cloudflare',
      fields: [{ name: 'key', label: 'Key' }],
      status,
      save: (given) => (saved.push(given), Promise.resolve()),
    }),
    root,
  )
  return { root, saved }
}

test('a needed key is pasted into a masked box and handed to save', async () => {
  let { root, saved } = drawn('needed')
  let box = root.querySelector('input')!
  assertEquals(box.getAttribute('type'), 'password')
  box.value = 'cfut_live'
  root.querySelector('form')!.dispatchEvent(
    new root.ownerDocument.defaultView!.Event('submit', { cancelable: true }),
  )
  await until(() => saved.length > 0, { label: 'saved' })
  assertEquals(saved, [{ key: 'cfut_live' }])
})

test('a refused key is asked for again, and a connected one asks nothing', () => {
  assertEquals(
    drawn('broken').root.textContent?.includes('refused the last key'),
    true,
  )
  assertEquals(drawn('connected').root.innerHTML, '')
})

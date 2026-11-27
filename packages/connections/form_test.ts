// The box a key is pasted in, as a live page draws it: asked for while the
// connection needs a key or its last was refused, gone once it is connected;
// what was typed goes to `save`, and the box is emptied.
import { test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { createElement as h } from 'react'
import { render } from 'preact'
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
  let draw = (status: string) =>
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
  draw(status)
  return { root, saved, draw }
}

let submitted = async (status: string, key: string) => {
  let drawing = drawn(status)
  let { root, saved } = drawing
  root.querySelector('input')!.value = key
  let form = root.querySelector('form')!
  // linkedom's form has no reset, as a browser's has
  form.reset = () => root.querySelectorAll('input').forEach((i) => i.value = '')
  form.dispatchEvent(
    new root.ownerDocument.defaultView!.Event('submit', { cancelable: true }),
  )
  await until(() => saved.length > 0, { label: 'saved' })
  return drawing
}

test('a needed key is pasted into a masked box and handed to save', async () => {
  assertEquals(
    drawn('needed').root.querySelector('input')!.getAttribute('type'),
    'password',
  )
  assertEquals((await submitted('needed', 'cfut_live')).saved, [{
    key: 'cfut_live',
  }])
})

test('a saved key, once connected, says so and offers no box', async () => {
  let { root, draw } = await submitted('needed', 'cfut_live')
  await until(() => root.textContent!.includes('Saved.'), { label: 'said' })
  draw('connected')
  assertEquals(root.querySelector('input'), null)
  assertEquals(root.textContent!.includes('connected'), true)
  assertEquals(root.textContent!.includes('Saved.'), true)
})

test('a refused key is asked for again, and a connected one asks nothing', () => {
  assertEquals(
    drawn('broken').root.textContent?.includes('refused the last key'),
    true,
  )
  assertEquals(drawn('connected').root.innerHTML, '')
})

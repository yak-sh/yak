// The sidebar is a short list of places, each a plain link to its own page.
import { test } from '@yaks/testing'
import '../testing.ts'
import { docs as schemaDocs } from '@yaks/vocab/vocab'
import { learn, vocab } from '../types.ts'
import { assertEquals } from '@std/assert'
import { act } from 'preact/test-utils'
import { config, owner } from '../live.ts'
import { host } from '../host_testing.ts'
import { bindHistory, route } from '../history.ts'
import { fields } from './fields.tsx'
import { Navigation, offer } from './Navigation.tsx'
import { mount } from './mount.ts'
import '../domain-host.tsx'

test('the sidebar lists its places, lights the one you are on, and goes where you ask', async () => {
  let docs = vocab.docs
  learn([...docs, ...schemaDocs])
  let prior = config.host
  config.host = 'browser.test'
  let wire = host(() => ({ bundles: [] }))
  owner.value = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  offer([{ key: 'bugs', name: 'Bugs', icon: 'bug', query: '.task' }])
  bindHistory(undefined)
  let { root, free } = mount(<Navigation />)
  let lines = () =>
    [...root.querySelectorAll('.Shell_Item')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
    ])
  let lit = () => root.querySelector('[aria-current=page]')?.textContent
  // An unmodified press, or a key, as a person's would arrive.
  let send = (el: Element, type: string, key?: string) =>
    act(() => {
      let ev = new root.ownerDocument.defaultView!.Event(type, {
        bubbles: true,
        cancelable: true,
      })
      el.dispatchEvent(Object.assign(ev, { key, button: 0 }))
    })
  let line = (name: string) =>
    [...root.querySelectorAll('.Shell_Item')].find((a) =>
      a.textContent == name
    )!
  try {
    assertEquals(lines(), [
      ['Inbox', '/'],
      ['Favorites', '/?favorites'],
      ['Recent', '/?recent'],
      ['Bugs', '/?bugs'],
      ['Sessions', '/?sessions'],
      ['Schema', '/?map'],
    ])
    assertEquals(lit(), 'Inbox')
    await send(line('Bugs'), 'click')
    assertEquals([route.value, lit()], ['/?bugs', 'Bugs'])
    await act(() => fields.set('sidebar:query', 'needle'))
    await send(root.querySelector('input')!, 'keydown', 'Enter')
    assertEquals([route.value, lit()], ['/?q=needle', undefined])
    assertEquals(fields.row('sidebar:query')?.text ?? '', '')
  } finally {
    free()
    wire.free()
    owner.value = undefined
    config.host = prior
    learn(docs)
  }
})

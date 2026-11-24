// A form over a desk whose changes this page's Preact cannot see (a yaks
// app's client.js drafts, bundled apart): a draft typed in another tab, or
// restored once the person is known, still draws.
import { h, render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { parseHTML } from 'linkedom'
import { equal, lend, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { Submit } from './Submit.ts'

let texts = new Map<string, string>()
let followers = new Set<() => void>()
let desk = {
  text: (place: string) => texts.get(place) ?? '',
  type: (place: string, text: string) => {
    texts.set(place, text)
    for (let fn of followers) fn()
  },
  spend: (place: string) => desk.type(place, ''),
  follow: (fn: () => void) => {
    followers.add(fn)
    fn()
    return () => followers.delete(fn)
  },
}
let Form = () => {
  let [e, setE] = useState<Bundle>()
  return h(Submit<object>, {
    at: 'note',
    place: 'note:body',
    drafts: desk,
    e,
    onChange: setE,
    read: () => Promise.resolve({}),
    send: () => Promise.resolve(undefined),
    render: ({ state }) => h('p', {}, String(state.values?.body ?? '')),
  })
}

test('a draft typed elsewhere draws, and stops being followed on unmount', async () => {
  let { document } = parseHTML('<html><body><main></main></body></html>')
  let back = lend('document', document)
  let root = document.querySelector('main')!
  try {
    await act(() => render(h(Form, {}), root))
    await act(async () => {}) // the form's content arrives
    equal(root.textContent, '')
    await act(() =>
      desk.type('note:body', JSON.stringify({ body: 'Back on Monday' }))
    )
    equal(root.textContent, 'Back on Monday')
    await act(() => render(null, root))
    equal(followers.size, 0)
  } finally {
    back()
  }
})

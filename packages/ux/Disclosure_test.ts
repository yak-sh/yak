/** Disclosure behavior is controlled by page bundles, in browsers and terminals. */
import { equal, test } from '@yaks/testing'
import { client } from '@yaks/client'
import { type Bundle } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { h, render } from 'preact'
import { signal } from '@preact/signals'
import { parseHTML } from 'linkedom'
import { mount } from '../tui/testing.ts'
import { disclosed, Disclosure, disclosureAt, isOpen } from './Disclosure.ts'
import { docs } from './vocab.ts'

let { document } = parseHTML('<html><body><main></main></body></html>')
let page = () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  let sent: Bundle[] = []
  let draw = (e: Bundle) =>
    render(
      h(Disclosure, {
        e,
        summary: 'Completed',
        summaryProps: { mod: 'quiet', class: 'journal-summary' },
        onChange: (b) => sent.push(b),
      }, h('p', {}, 'Saved the village')),
      root,
    )
  return {
    root,
    sent,
    draw,
    button: () => root.querySelector('button')!,
    [Symbol.dispose]: () => {
      render(null, root)
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else Reflect.deleteProperty(globalThis, 'document')
    },
  }
}

// Draw each supplied state once and retain what the controlled view shows and
// emits. The page is released before another host installs its document.
let states = [undefined, false, true].map((open) => {
  using p = page()
  let e: Bundle = {
    entity: { eid: disclosureAt('journal') },
    ...(open === undefined ? {} : { Disclosure: { open } }),
  }
  p.draw(e)
  let button = p.button()
  let body = p.root.ownerDocument.getElementById(
    button.getAttribute('aria-controls')!,
  )!
  let state = {
    open,
    e,
    expanded: button.getAttribute('aria-expanded'),
    shown: !!p.root.querySelector('p'),
    summary: button.textContent,
    styled: button.classList.contains('journal-summary'),
    hidden: body.hasAttribute('hidden'),
  }
  button.click()
  return { ...state, emitted: p.sent.pop(), after: !!p.root.querySelector('p') }
})
test('a disclosure is closed unless its supplied state says open', () => {
  for (let state of states) {
    let { open, e } = state
    equal(isOpen(e), open === true)
    equal(state.expanded, String(open === true))
    equal(state.shown, open === true)
    equal(state.summary, 'Completed')
    equal(state.styled, true)
    equal(state.hidden, open !== true)
    equal(state.emitted, disclosed(e, open !== true))
    equal(
      state.after,
      open === true,
      'only the supplied state changes what is shown',
    )
  }
  equal(isOpen(), false)
})

test('the page graph keeps disclosure state across remounts and apart by owner', async () => {
  using p = page()
  let front = client(loadVocab(docs), [], { vault: false, wireVault: false })
  let eid = disclosureAt('journal/meadow')
  let e = { entity: { eid } }
  try {
    p.draw(e)
    p.button().click()
    await front.mutate(p.sent)
    render(null, p.root)
    p.draw(front.ent(eid)!)
    equal(!!p.root.querySelector('p'), true)
    p.draw({ entity: { eid: disclosureAt('journal/forest') } })
    equal(!!p.root.querySelector('p'), false)
    p.draw(front.ent(eid)!)
    p.button().click()
    await front.mutate([p.sent.at(-1)!])
    render(null, p.root)
    p.draw(front.ent(eid)!)
    equal(!!p.root.querySelector('p'), false)
  } finally {
    front.close()
  }
})

test('a terminal disclosure follows the same supplied bundle', async () => {
  let e = signal<Bundle>({ entity: { eid: disclosureAt('terminal') } })
  let App = () =>
    h(Disclosure, {
      e: e.value,
      onChange: (b) => e.value = b,
      summary: 'Completed',
    }, h('div', {}, 'Saved the village'))
  let ui = await mount(App, 30, 4)
  try {
    equal(ui.text().includes('Saved the village'), false)
    await ui.send('\x1b[<0;2;1M\x1b[<0;2;1m')
    equal(isOpen(e.value), true)
    equal(ui.text().includes('Saved the village'), true)
    await ui.send('\x1b[<0;2;1M\x1b[<0;2;1m')
    equal(isOpen(e.value), false)
    equal(ui.text().includes('Saved the village'), false)
  } finally {
    ui.free()
  }
})

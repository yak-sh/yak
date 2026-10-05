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

let page = () => {
  let { document } = parseHTML('<html><body><main></main></body></html>')
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

test('a disclosure is closed unless its supplied state says open', () => {
  using p = page()
  for (let open of [undefined, false, true]) {
    let e: Bundle = {
      entity: { eid: disclosureAt('journal') },
      ...(open === undefined ? {} : { Disclosure: { open } }),
    }
    p.draw(e)
    equal(isOpen(e), open === true)
    equal(p.button().getAttribute('aria-expanded'), String(open === true))
    equal(!!p.root.querySelector('p'), open === true)
    equal(p.button().textContent, 'Completed')
    equal(p.button().classList.contains('journal-summary'), true)
    let body = p.root.ownerDocument.getElementById(
      p.button().getAttribute('aria-controls')!,
    )!
    equal(body.hasAttribute('hidden'), open !== true)
    p.button().click()
    equal(p.sent.pop(), disclosed(e, open !== true))
    equal(
      !!p.root.querySelector('p'),
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

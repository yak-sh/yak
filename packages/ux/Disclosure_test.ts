/** Disclosure behavior is controlled by page bundles, in browsers and terminals. */
import { equal, test } from '@yaks/testing'
import { client } from '@yaks/client'
import { type Bundle } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { h, render } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { signal } from '@preact/signals'
import { parseHTML } from 'linkedom'
import { mount } from '../tui/testing.ts'
import {
  disclosed,
  Disclosure,
  disclosureAt,
  DisclosureMark,
  type DisclosureProps,
  isOpen,
} from './Disclosure.ts'
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
  let draw = (e: Bundle, more: Partial<DisclosureProps> = {}) =>
    render(
      h(
        'div',
        {},
        h(DisclosureMark, { e, onChange: (b) => sent.push(b) }, '☎'),
        h(Disclosure, {
          e,
          summary: 'Completed',
          mod: 'quiet',
          onChange: (b) => sent.push(b),
          ...more,
        }, h('p', {}, 'Saved the village')),
      ),
      root,
    )
  return {
    root,
    sent,
    draw,
    open: () => root.querySelector('details')!.hasAttribute('open'),
    held: () => !!root.querySelector('details p'),
    press: (q: string) => (root.querySelector(q) as HTMLElement).click(),
    [Symbol.dispose]: () => {
      render(null, root)
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else Reflect.deleteProperty(globalThis, 'document')
    },
  }
}

let at = (open?: boolean): Bundle => ({
  entity: { eid: disclosureAt('journal') },
  ...(open === undefined ? {} : { Disclosure: { open } }),
})

test('a disclosure is the kit fold, open only as its supplied state says, and its summary and mark each ask for the other', () => {
  for (let open of [undefined, false, true]) {
    using p = page()
    let e = at(open)
    p.draw(e)
    equal(p.open(), open === true)
    equal(p.held(), true, 'closed, it still holds what it opens on')
    equal(p.root.querySelector('summary')!.textContent, 'Completed')
    equal(p.root.querySelector('details.More-quiet') != null, true)
    let mark = p.root.querySelector('button.More_Mark')!
    equal(mark.getAttribute('aria-expanded'), String(open === true))
    equal(
      p.root.ownerDocument.getElementById(mark.getAttribute('aria-controls')!)
        ?.textContent,
      'Saved the village',
    )
    p.press('summary')
    p.press('button.More_Mark')
    equal(p.sent, [disclosed(e, open !== true), disclosed(e, open !== true)])
    equal(p.open(), open === true, 'only the supplied state changes it')
  }
  equal(isOpen(), false)
})

test('a lazy disclosure draws what it holds only while open', () => {
  using p = page()
  p.draw(at(false), { lazy: true })
  equal(p.held(), false)
  p.draw(at(true), { lazy: true })
  equal(p.held(), true)
})

test('drawn on a server, a closed disclosure is a details that opens with no script', () => {
  let { document } = parseHTML(
    renderToString(
      h(Disclosure, { e: at(), summary: 'Completed' }, h('p', {}, 'Saved')),
    ),
  )
  let fold = document.querySelector('details')!
  equal(fold.hasAttribute('open'), false)
  equal(fold.querySelector('summary')?.textContent, 'Completed')
  equal(fold.querySelector('.More_Body p')?.textContent, 'Saved')
})

test('the page graph keeps disclosure state across remounts and apart by owner', async () => {
  using p = page()
  let front = client(loadVocab(docs), [], { vault: false, wireVault: false })
  let eid = disclosureAt('journal/meadow')
  try {
    p.draw({ entity: { eid } })
    p.press('summary')
    await front.mutate(p.sent)
    render(null, p.root)
    p.draw(front.ent(eid)!)
    equal(p.open(), true)
    p.draw({ entity: { eid: disclosureAt('journal/forest') } })
    equal(p.open(), false)
    p.draw(front.ent(eid)!)
    p.press('summary')
    await front.mutate([p.sent.at(-1)!])
    render(null, p.root)
    p.draw(front.ent(eid)!)
    equal(p.open(), false)
  } finally {
    front.close()
  }
})

test('a terminal disclosure follows the same supplied bundle, and shows only its summary while closed', async () => {
  let e = signal<Bundle>({ entity: { eid: disclosureAt('terminal') } })
  let App = () =>
    h(Disclosure, {
      e: e.value,
      onChange: (b) => e.value = b,
      summary: 'Completed',
    }, h('div', {}, 'Saved the village'))
  let ui = await mount(App, 30, 4)
  try {
    equal(ui.text().includes('▸ Completed'), true)
    equal(ui.text().includes('Saved the village'), false)
    await ui.send('\x1b[<0;3;1M\x1b[<0;3;1m')
    equal(isOpen(e.value), true)
    equal(ui.text().includes('▾ Completed'), true)
    equal(ui.text().includes('Saved the village'), true)
    await ui.send('\x1b[<0;3;1M\x1b[<0;3;1m')
    equal(isOpen(e.value), false)
    equal(ui.text().includes('Saved the village'), false)
  } finally {
    ui.free()
  }
})

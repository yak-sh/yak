// A journal with an isolated page graph and Linkedom document. Linkedom binds
// bubbling listeners to the target, so clicks on nested icons need a native DOM.
import { parseHTML } from 'linkedom'
import { render } from 'preact'
import { journal } from './journal.ts'
import { pageState } from './page-state.ts'

export let withJournal = async (
  run: (f: ReturnType<typeof fixture>) => void | Promise<void>,
) => {
  let f = fixture()
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: f.body.ownerDocument,
    configurable: true,
  })
  try {
    await f.state.ready
    await run(f)
  } finally {
    for (
      let node of f.body.querySelectorAll<HTMLElement>(
        '.Split_List, .Split_Content',
      )
    ) render(null, node)
    f.state.dispose()
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}
let fixture = () => {
  let { document, window } = parseHTML(
    '<html><body><main></main></body></html>',
  )
  let body = document.querySelector<HTMLElement>('main')!
  let state = pageState()
  let pins: [string, boolean][] = []
  let page = {
    body,
    open: true,
    show: () => {},
    close: () => {},
    toggle: () => {},
  }
  let view = journal(page, { pin: (id, on) => pins.push([id, on]) }, state)
  let click = (selector: string) => {
    let node = body.querySelector(selector)
    if (!node) throw new Error(`Missing ${selector}`)
    node.dispatchEvent(new window.Event('click', { bubbles: true }))
  }
  return { body, state, pins, view, click }
}

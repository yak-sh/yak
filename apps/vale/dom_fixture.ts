// A Linkedom page for the vale's views, whose `document` and element classes
// stand in as the globals Preact and the views read while `run` runs; the
// globals they replaced are put back after, whether it returns, throws or
// settles.
import { parseHTML } from 'linkedom'
import { type ComponentChildren, Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'

export type Dom = ReturnType<typeof parseHTML>

let NAMES = ['document', 'Element', 'HTMLInputElement'] as const

export let withDom = <T>(
  run: (dom: Dom, main: HTMLElement) => T,
  html = '<html><body><main></main></body></html>',
): T => {
  let dom = parseHTML(html)
  let prior = NAMES.map((n) => Object.getOwnPropertyDescriptor(globalThis, n))
  let values = [dom.document, dom.window.Element, dom.window.HTMLInputElement]
  NAMES.forEach((n, i) =>
    Object.defineProperty(globalThis, n, {
      value: values[i],
      configurable: true,
    })
  )
  let restore = () =>
    NAMES.forEach((n, i) =>
      prior[i]
        ? Object.defineProperty(globalThis, n, prior[i]!)
        : Reflect.deleteProperty(globalThis, n)
    )
  let result: T
  try {
    result = run(dom, dom.document.querySelector('main') ?? dom.document.body)
  } catch (e) {
    restore()
    throw e
  }
  if (result instanceof Promise) {
    return result.finally(restore) as T
  }
  restore()
  return result
}

/** What `nodes` draw, as the body of a page of their own. */
export let drawn = (nodes: ComponentChildren): HTMLElement =>
  parseHTML(
    `<html><body>${renderToString(h(Fragment, null, nodes))}</body></html>`,
  ).document.body

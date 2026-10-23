// Test-only: mount a renderer through Preact and hand back the container to
// assert on. A renderer is a component — several hold hooks — so it must be
// MOUNTED, never called as a bare function, which bypasses Preact's hook
// dispatcher (registry.ts). Callers build the vnode the production way,
// `h(resolve(e, view).Render, props)`, and read the resulting DOM, under the
// page's UX host (registry.ts `ux`) as main.tsx mounts the app. Sets up a
// shared linkedom document, mounts into its own <main>, and returns that root
// plus a free() that unmounts and restores the document global. Pair every
// mount() with free() — a try/finally, or the end of the test.
import { type ComponentChild, h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { Ux } from '@yaks/ux'
import { ux } from './registry.ts'

// Linkedom shares element prototypes across documents but omits the browser's
// selection API. Completion fields restore their caret in a layout effect,
// including in tests that install a document of their own.
let { document, window } = parseHTML('<html><body></body></html>')
for (
  let prototype of [
    window.HTMLInputElement.prototype,
    window.HTMLTextAreaElement.prototype,
  ]
) {
  prototype.setSelectionRange = function (start: number, end: number) {
    this.selectionStart = start
    this.selectionEnd = end
  }
}
// Nor does it keep the focus: focus and blur move the document's
// activeElement, and say so, and an element taken out of the page lets go of
// it, as a browser's do.
let held = new WeakMap<object, Element | null>()
Object.defineProperty(window.Document.prototype, 'activeElement', {
  get() {
    let at = held.get(this)
    return at?.isConnected ? at : null
  },
  configurable: true,
})
let element = window.HTMLElement.prototype
element.focus = function (this: HTMLElement) {
  let doc = this.ownerDocument
  if (doc.activeElement == this) return
  ;(doc.activeElement as HTMLElement | null)?.blur()
  held.set(doc, this)
  this.dispatchEvent(new window.Event('focus'))
  this.dispatchEvent(new window.Event('focusin', { bubbles: true }))
}
element.blur = function (this: HTMLElement) {
  let doc = this.ownerDocument
  if (doc.activeElement != this) return
  held.set(doc, null)
  this.dispatchEvent(new window.Event('blur'))
  this.dispatchEvent(new window.Event('focusout', { bubbles: true }))
}
export let mount = (node: ComponentChild) => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.createElement('main')
  document.body.append(root)
  render(h(Ux, { host: ux }, node), root)
  return {
    root,
    free() {
      render(null, root)
      root.remove()
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else delete (globalThis as { document?: unknown }).document
    },
  }
}

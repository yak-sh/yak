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

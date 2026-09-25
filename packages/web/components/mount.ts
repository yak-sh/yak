// Test-only: mount a renderer through Preact and hand back the container to
// assert on. A renderer is a component — several hold hooks — so it must be
// MOUNTED, never called as a bare function, which bypasses Preact's hook
// dispatcher (registry.ts). Callers build the vnode the production way,
// `h(resolve(e, view).Render, props)`, and read the resulting DOM. Sets up a
// throwaway linkedom document, mounts into a <main>, and returns that root
// plus a free() that unmounts and restores the document global. Pair every
// mount() with free() — a try/finally, or the end of the test.
import { type ComponentChild, render } from 'preact'
import { parseHTML } from 'linkedom'

export let mount = (node: ComponentChild) => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  render(node, root)
  return {
    root,
    free() {
      render(null, root)
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else delete (globalThis as { document?: unknown }).document
    },
  }
}

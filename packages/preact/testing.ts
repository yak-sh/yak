// Mounted Preact tests share a document but own separate roots, and restore
// the previous global document on exit.
// Updates use the same root so listener cleanup and prop changes are exercised
// through reconciliation, not by calling a component as an ordinary function.

import { type ComponentChild, render } from 'preact'
import { parseHTML } from 'linkedom'

let window = parseHTML('<html><body></body></html>')
let { document } = window

/** The shared document's own event classes, which its targets dispatch. */
export let { CustomEvent } = window

/** Install the document and give a root of its own; `free` empties and
 * removes it and puts the previous global document back. */
export let stage = () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.createElement('main')
  document.body.append(root)
  let free = () => {
    render(null, root)
    root.remove()
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
  return { root, document, free }
}

/** Install a document, mount, and return an explicit cleanup for the test. */
export let mount = (node: ComponentChild) => {
  let { root, free } = stage()
  try {
    render(node, root)
  } catch (error) {
    free()
    throw error
  }
  return { root, update: (next: ComponentChild) => render(next, root), free }
}

/** Preact queues state updates on its next microtask. */
export let flush = async (): Promise<void> => {
  await Promise.resolve()
}

// A mounted Preact test owns a temporary document and restores it on exit.
// Updates use the same root so listener cleanup and prop changes are exercised
// through reconciliation, not by calling a component as an ordinary function.

import { type ComponentChild, render } from 'preact'
import { parseHTML } from 'linkedom'

/** Install a document, mount, and return an explicit cleanup for the test. */
export let mount = (node: ComponentChild) => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  let free = () => {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
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

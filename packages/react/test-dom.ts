import type { ReactNode } from 'react'
import { parseHTML } from 'linkedom'
import { render } from './draw.ts'

let page = parseHTML('<html><body></body></html>')
let { document } = page

export let { CustomEvent } = page

/** Install a document and give a root of its own. */
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
    else Reflect.deleteProperty(globalThis, 'document')
  }
  return { root, document, free }
}

/** Mount a view and return what takes it down and restores the document. */
export let mount = (node: ReactNode) => {
  let { root, free } = stage()
  try {
    render(node, root)
  } catch (error) {
    free()
    throw error
  }
  return { root, free }
}

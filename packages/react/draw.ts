/** React drawing into a browser document or a tree a host paints. @module */

import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

type Surface = { draw: (node: ReactNode) => void; close: () => void }

// React DOM consults window and the iframe constructor for focus restoration.
// The in-memory document has neither a window of its own nor frame elements.
let surfaces = 0
let restore: () => void
let attach = (doc: Document) => {
  if (doc.defaultView) return () => {}
  if (surfaces++ == 0) {
    let names: string[] = []
    for (
      let [name, value] of [
        ['window', globalThis],
        ['HTMLIFrameElement', class {}],
      ] as const
    ) {
      if (name in globalThis) continue
      Object.defineProperty(globalThis, name, { value, configurable: true })
      names.push(name)
    }
    restore = () => {
      for (let name of names) Reflect.deleteProperty(globalThis, name)
    }
  }
  return () => {
    if (--surfaces == 0) restore()
  }
}

/** Mount a React root whose draws commit before returning, so its caller can
 * measure the tree or restore selection and scroll after a draft swap. */
export let surface = (
  into: Element,
  fell?: (error: unknown) => void,
): Surface => {
  let release = attach(into.ownerDocument)
  let root
  let committing = false
  let failure: { error: unknown } | undefined
  let open: (
    into: Element,
    options?: { onUncaughtError: (error: unknown) => void },
  ) => ReturnType<typeof createRoot> = createRoot
  try {
    root = open(into, {
      onUncaughtError(error) {
        if (committing) failure = { error }
        else if (fell) fell(error)
        else {queueMicrotask(() => {
            throw error
          })}
      },
    })
  } catch (error) {
    release()
    throw error
  }
  let closed = false
  return {
    draw: (node) => {
      failure = undefined
      committing = true
      try {
        flushSync(() => root.render(node))
      } finally {
        committing = false
      }
      if (failure) throw (failure as { error: unknown }).error
    },
    close: () => {
      if (closed) return
      closed = true
      try {
        root.unmount()
      } finally {
        release()
      }
    },
  }
}

/** Draw a view into a tree and return what takes it down. */
export let draw = (node: ReactNode, into: Element): () => void => {
  let mount = surface(into)
  try {
    mount.draw(node)
  } catch (error) {
    mount.close()
    throw error
  }
  return mount.close
}
